import { Logger } from "winston";
import { getACUCTeam } from "../controllers/auth";
import { getRedisConnection } from "../services/queue-service";
import { scrapeQueue } from "../services/worker/nuq";
import { RateLimiterMode } from "../types";
import {
  getConcurrencyLimitActiveJobs,
  pushConcurrencyLimitActiveJob,
  pushConcurrencyLimitedJob,
  pushCrawlConcurrencyLimitActiveJob,
} from "./concurrency-limit";
import { getCrawl } from "./crawl-redis";
import { logger as _logger } from "./logger";

interface ReconcileOptions {
  teamId?: string;
  logger?: Logger;
}

interface ReconcileResult {
  teamsScanned: number;
  teamsWithDrift: number;
  jobsRequeued: number;
  jobsStarted: number;
}

function getBacklogJobTimeout(jobData: any): number {
  return jobData?.crawl_id
    ? Infinity
    : (jobData?.scrapeOptions?.timeout ?? 60 * 1000);
}

async function getQueuedJobIDs(teamId: string): Promise<Set<string>> {
  const queuedJobIDs = new Set<string>();
  let cursor = "0";

  do {
    const [nextCursor, results] = await getRedisConnection().zscan(
      `concurrency-limit-queue:${teamId}`,
      cursor,
      "COUNT",
      100,
    );
    cursor = nextCursor;

    // zscan returns [member1, score1, member2, score2, ...]
    for (let i = 0; i < results.length; i += 2) {
      queuedJobIDs.add(results[i]);
    }
  } while (cursor !== "0");

  return queuedJobIDs;
}

export async function reconcileConcurrencyQueue(
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const logger = (options.logger ?? _logger).child({
    module: "concurrencyQueueReconciler",
    scopedTeamId: options.teamId,
  });

  const owners = options.teamId
    ? [options.teamId]
    : await scrapeQueue.getBackloggedOwnerIDs(logger);

  const ownerIds = owners.filter((x): x is string => typeof x === "string");

  const result: ReconcileResult = {
    teamsScanned: ownerIds.length,
    teamsWithDrift: 0,
    jobsRequeued: 0,
    jobsStarted: 0,
  };

  for (const ownerId of ownerIds) {
    const teamLogger = logger.child({ teamId: ownerId });

    try {
      const backloggedJobIDs = new Set(
        await scrapeQueue.getBackloggedJobIDsOfOnwer(ownerId, teamLogger),
      );
      if (backloggedJobIDs.size === 0) {
        continue;
      }

      const queuedJobIDs = await getQueuedJobIDs(ownerId);
      const missingJobIDs = [...backloggedJobIDs].filter(
        x => !queuedJobIDs.has(x),
      );

      if (missingJobIDs.length === 0) {
        continue;
      }

      result.teamsWithDrift++;

      const jobsToRecover = await scrapeQueue.getJobsFromBacklog(
        missingJobIDs,
        teamLogger,
      );
      if (jobsToRecover.length === 0) {
        continue;
      }

      const maxCrawlConcurrency =
        (await getACUCTeam(ownerId, false, true, RateLimiterMode.Crawl))
          ?.concurrency ?? 2;
      const maxExtractConcurrency =
        (await getACUCTeam(ownerId, false, true, RateLimiterMode.Extract))
          ?.concurrency ?? 2;

      // Split active count by type so one type's active jobs don't gate the other
      const activeJobIds = await getConcurrencyLimitActiveJobs(ownerId);
      const activeJobs = await scrapeQueue.getJobs(activeJobIds, teamLogger);
      let activeCrawlCount = 0;
      let activeExtractCount = 0;
      for (const aj of activeJobs) {
        if ("is_extract" in aj.data && aj.data.is_extract) {
          activeExtractCount++;
        } else {
          activeCrawlCount++;
        }
      }

      const jobsToStart: typeof jobsToRecover = [];
      const jobsToQueue: typeof jobsToRecover = [];

      for (const job of jobsToRecover) {
        const isExtract = "is_extract" in job.data && job.data.is_extract;
        const teamLimit = isExtract
          ? maxExtractConcurrency
          : maxCrawlConcurrency;
        const activeCount = isExtract ? activeExtractCount : activeCrawlCount;

        if (activeCount < teamLimit) {
          jobsToStart.push(job);
          if (isExtract) activeExtractCount++;
          else activeCrawlCount++;
        } else {
          jobsToQueue.push(job);
        }
      }

      let teamJobsStarted = 0;
      let teamJobsRequeued = 0;

      for (const job of jobsToQueue) {
        await pushConcurrencyLimitedJob(
          ownerId,
          {
            id: job.id,
            data: job.data,
            priority: job.priority,
            listenable: job.listenChannelId !== undefined,
          },
          getBacklogJobTimeout(job.data),
        );
        teamJobsRequeued++;
        result.jobsRequeued++;
      }

      for (const job of jobsToStart) {
        const promoted = await scrapeQueue.promoteJobFromBacklogOrAdd(
          job.id,
          job.data,
          {
            priority: job.priority,
            listenable: job.listenChannelId !== undefined,
            ownerId: job.data.team_id ?? undefined,
            groupId: job.data.crawl_id ?? undefined,
          },
        );

        if (promoted !== null) {
          await pushConcurrencyLimitActiveJob(ownerId, job.id, 60 * 1000);

          if (job.data.crawl_id) {
            const sc = await getCrawl(job.data.crawl_id);
            if (sc?.crawlerOptions?.delay || sc?.maxConcurrency) {
              await pushCrawlConcurrencyLimitActiveJob(
                job.data.crawl_id,
                job.id,
                60 * 1000,
              );
            }
          }

          teamJobsStarted++;
          result.jobsStarted++;
        } else {
          teamLogger.warn("Job promotion failed, re-queuing job", {
            jobId: job.id,
          });
          await pushConcurrencyLimitedJob(
            ownerId,
            {
              id: job.id,
              data: job.data,
              priority: job.priority,
              listenable: job.listenChannelId !== undefined,
            },
            getBacklogJobTimeout(job.data),
          );
          teamJobsRequeued++;
          result.jobsRequeued++;
        }
      }

      teamLogger.info("Recovered drift in concurrency queue", {
        missingJobs: missingJobIDs.length,
        recoveredJobs: jobsToRecover.length,
        requeuedJobs: teamJobsRequeued,
        startedJobs: teamJobsStarted,
      });
    } catch (error) {
      teamLogger.error("Failed to reconcile team, skipping", { error });
    }
  }

  return result;
}
