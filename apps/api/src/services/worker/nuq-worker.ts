import "dotenv/config";
import { config } from "../../config";
import "../sentry";
import { setSentryServiceTag } from "../sentry";
import { logger as _logger } from "../../lib/logger";
import { processJobInternal } from "./scrape-worker";
import { scrapeQueue, nuqGetLocalMetrics, nuqHealthCheck } from "./nuq";
import Express from "express";
import { _ } from "ajv";
import { initializeBlocklist } from "../../scraper/WebScraper/utils/blocklist";
import { initializeEngineForcing } from "../../scraper/WebScraper/utils/engine-forcing";
import { getRedisConnection } from "../queue-service";
import { reconcileConcurrencyQueue } from "../../lib/concurrency-queue-reconciler";
import { Counter, register } from "prom-client";

const RECONCILER_INTERVAL_MS = 60 * 1000;
const RECONCILER_LOCK_TTL_MS = RECONCILER_INTERVAL_MS * 1.5;
const RECONCILER_LOCK_KEY = "concurrency-queue-reconciler:lock";

const reconcilerRunsTotal = new Counter({
  name: "concurrency_queue_reconciler_runs_total",
  help: "Total completed concurrency queue reconciler runs",
});

const reconcilerFailuresTotal = new Counter({
  name: "concurrency_queue_reconciler_failures_total",
  help: "Total failed concurrency queue reconciler runs",
});

const reconcilerJobsRecoveredTotal = new Counter({
  name: "concurrency_queue_reconciler_jobs_recovered_total",
  help: "Total drifted jobs recovered by the reconciler",
});

(async () => {
  setSentryServiceTag("nuq-worker");

  try {
    await initializeBlocklist();
    initializeEngineForcing();
  } catch (error) {
    _logger.error("Failed to initialize blocklist and engine forcing", {
      error,
    });
    process.exit(1);
  }

  let isShuttingDown = false;
  let reconcilerInFlight = false;

  const app = Express();

  app.get("/metrics", async (_, res) => {
    res
      .contentType("text/plain")
      .send(`${nuqGetLocalMetrics()}${await register.metrics()}`);
  });
  app.get("/health", async (_, res) => {
    if (await nuqHealthCheck()) {
      res.status(200).send("OK");
    } else {
      res.status(500).send("Not OK");
    }
  });

  const server = app.listen(config.NUQ_WORKER_PORT, () => {
    _logger.info("NuQ worker metrics server started");
  });

  function shutdown() {
    isShuttingDown = true;
  }

  const runReconciler = async () => {
    if (isShuttingDown || reconcilerInFlight) return;

    const lockValue = `${config.NUQ_POD_NAME}:${Date.now()}`;
    const gotLock = await getRedisConnection().set(
      RECONCILER_LOCK_KEY,
      lockValue,
      "PX",
      RECONCILER_LOCK_TTL_MS,
      "NX",
    );

    if (!gotLock) return;

    reconcilerInFlight = true;

    try {
      const summary = await reconcileConcurrencyQueue({
        logger: _logger,
      });

      reconcilerRunsTotal.inc();
      reconcilerJobsRecoveredTotal.inc(
        summary.jobsRequeued + summary.jobsStarted,
      );

      _logger.info("Concurrency queue reconciler run complete", summary);
    } catch (error) {
      reconcilerFailuresTotal.inc();
      _logger.error("Concurrency queue reconciler run failed", { error });
    } finally {
      reconcilerInFlight = false;
      await getRedisConnection()
        .eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          1,
          RECONCILER_LOCK_KEY,
          lockValue,
        )
        .catch(() => {});
    }
  };

  if (require.main === module) {
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  const reconcilerInterval = setInterval(() => {
    runReconciler().catch(error =>
      _logger.error("Concurrency queue reconciler timer failed", { error }),
    );
  }, RECONCILER_INTERVAL_MS);
  runReconciler().catch(error =>
    _logger.error("Concurrency queue reconciler startup run failed", { error }),
  );

  let noJobTimeout = 1500;

  while (!isShuttingDown) {
    const job = await scrapeQueue.getJobToProcess();

    if (job === null) {
      _logger.info("No jobs to process", { module: "nuq/metrics" });
      await new Promise(resolve => setTimeout(resolve, noJobTimeout));
      if (!config.NUQ_RABBITMQ_URL) {
        noJobTimeout = Math.min(noJobTimeout * 2, 10000);
      }
      continue;
    }

    noJobTimeout = 500;

    const logger = _logger.child({
      module: "nuq-worker",
      scrapeId: job.id,
      zeroDataRetention: job.data?.zeroDataRetention ?? false,
    });

    logger.info("Acquired job");

    const lockRenewInterval = setInterval(async () => {
      logger.info("Renewing lock");
      if (!(await scrapeQueue.renewLock(job.id, job.lock!, logger))) {
        logger.warn("Failed to renew lock");
        clearInterval(lockRenewInterval);
        return;
      }
      logger.info("Renewed lock");
    }, 15000);

    let processResult:
      | { ok: true; data: Awaited<ReturnType<typeof processJobInternal>> }
      | { ok: false; error: any };

    try {
      processResult = { ok: true, data: await processJobInternal(job) };
    } catch (error) {
      processResult = { ok: false, error };
    }

    clearInterval(lockRenewInterval);

    if (processResult.ok) {
      if (
        !(await scrapeQueue.jobFinish(
          job.id,
          job.lock!,
          processResult.data,
          logger,
        ))
      ) {
        logger.warn("Could not update job status");
      }
    } else {
      if (
        !(await scrapeQueue.jobFail(
          job.id,
          job.lock!,
          processResult.error instanceof Error
            ? processResult.error.message
            : typeof processResult.error === "string"
              ? processResult.error
              : JSON.stringify(processResult.error),
          logger,
        ))
      ) {
        logger.warn("Could not update job status");
      }
    }
  }

  _logger.info("NuQ worker shutting down");
  clearInterval(reconcilerInterval);

  server.close(async () => {
    await scrapeQueue.shutdown();
    _logger.info("NuQ worker shut down");
    process.exit(0);
  });
})();
