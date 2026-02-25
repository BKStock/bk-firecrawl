package com.firecrawl.client;

import com.firecrawl.errors.FirecrawlException;
import com.firecrawl.errors.JobTimeoutException;
import com.firecrawl.models.*;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.ForkJoinPool;

/**
 * Client for the Firecrawl v2 API.
 *
 * <p>Example usage:
 * <pre>{@code
 * FirecrawlClient client = FirecrawlClient.builder()
 *     .apiKey("fc-your-api-key")
 *     .build();
 *
 * // Scrape a single page
 * Document doc = client.scrape("https://example.com",
 *     ScrapeOptions.builder()
 *         .formats(List.of("markdown"))
 *         .build());
 *
 * // Crawl a website
 * CrawlJob job = client.crawl("https://example.com",
 *     CrawlOptions.builder()
 *         .limit(50)
 *         .build());
 * }</pre>
 */
public class FirecrawlClient {

    private static final String DEFAULT_API_URL = "https://api.firecrawl.dev";
    private static final long DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
    private static final int DEFAULT_MAX_RETRIES = 3;
    private static final double DEFAULT_BACKOFF_FACTOR = 0.5;
    private static final int DEFAULT_POLL_INTERVAL = 2; // seconds
    private static final int DEFAULT_JOB_TIMEOUT = 300; // seconds

    private final FirecrawlHttpClient http;
    private final Executor asyncExecutor;

    private FirecrawlClient(FirecrawlHttpClient http, Executor asyncExecutor) {
        this.http = http;
        this.asyncExecutor = asyncExecutor;
    }

    /**
     * Creates a new builder for constructing a FirecrawlClient.
     */
    public static Builder builder() {
        return new Builder();
    }

    /**
     * Creates a client from the FIRECRAWL_API_KEY environment variable.
     */
    public static FirecrawlClient fromEnv() {
        String apiKey = System.getenv("FIRECRAWL_API_KEY");
        if (apiKey == null || apiKey.isEmpty()) {
            String sysProp = System.getProperty("firecrawl.apiKey");
            if (sysProp == null || sysProp.isEmpty()) {
                throw new FirecrawlException("FIRECRAWL_API_KEY environment variable or firecrawl.apiKey system property is required");
            }
            apiKey = sysProp;
        }
        return builder().apiKey(apiKey).build();
    }

    // ================================================================
    // SCRAPE
    // ================================================================

    /**
     * Scrapes a single URL and returns the document.
     *
     * @param url the URL to scrape
     * @return the scraped document
     */
    public Document scrape(String url) {
        return scrape(url, null);
    }

    /**
     * Scrapes a single URL with options.
     *
     * @param url     the URL to scrape
     * @param options scrape configuration options
     * @return the scraped document
     */
    public Document scrape(String url, ScrapeOptions options) {
        Objects.requireNonNull(url, "URL is required");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("url", url);
        if (options != null) {
            mergeOptions(body, options);
        }
        return extractData(http.post("/v1/scrape", body, Map.class), Document.class);
    }

    // ================================================================
    // CRAWL
    // ================================================================

    /**
     * Starts an async crawl job and returns immediately.
     *
     * @param url     the URL to start crawling from
     * @param options crawl configuration options
     * @return the crawl job reference with ID
     */
    public CrawlResponse startCrawl(String url, CrawlOptions options) {
        Objects.requireNonNull(url, "URL is required");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("url", url);
        if (options != null) {
            mergeOptions(body, options);
        }
        return http.post("/v1/crawl", body, CrawlResponse.class);
    }

    /**
     * Gets the status and results of a crawl job.
     *
     * @param jobId the crawl job ID
     * @return the crawl job status
     */
    public CrawlJob getCrawlStatus(String jobId) {
        Objects.requireNonNull(jobId, "Job ID is required");
        return http.get("/v1/crawl/" + jobId, CrawlJob.class);
    }

    /**
     * Crawls a website and waits for completion (auto-polling).
     *
     * @param url     the URL to crawl
     * @param options crawl configuration options
     * @return the completed crawl job with all documents
     */
    public CrawlJob crawl(String url, CrawlOptions options) {
        return crawl(url, options, DEFAULT_POLL_INTERVAL, DEFAULT_JOB_TIMEOUT);
    }

    /**
     * Crawls a website and waits for completion with custom polling settings.
     *
     * @param url            the URL to crawl
     * @param options        crawl configuration options
     * @param pollIntervalSec seconds between status checks
     * @param timeoutSec     maximum seconds to wait
     * @return the completed crawl job with all documents
     */
    public CrawlJob crawl(String url, CrawlOptions options, int pollIntervalSec, int timeoutSec) {
        CrawlResponse start = startCrawl(url, options);
        return pollCrawl(start.getId(), pollIntervalSec, timeoutSec);
    }

    /**
     * Cancels a running crawl job.
     *
     * @param jobId the crawl job ID
     * @return the cancellation response
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> cancelCrawl(String jobId) {
        Objects.requireNonNull(jobId, "Job ID is required");
        return http.delete("/v1/crawl/" + jobId, Map.class);
    }

    /**
     * Gets errors from a crawl job.
     *
     * @param jobId the crawl job ID
     * @return error details
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getCrawlErrors(String jobId) {
        Objects.requireNonNull(jobId, "Job ID is required");
        return http.get("/v1/crawl/" + jobId + "/errors", Map.class);
    }

    // ================================================================
    // BATCH SCRAPE
    // ================================================================

    /**
     * Starts an async batch scrape job.
     *
     * @param urls    the URLs to scrape
     * @param options batch scrape configuration options
     * @return the batch job reference with ID
     */
    public BatchScrapeResponse startBatchScrape(List<String> urls, BatchScrapeOptions options) {
        Objects.requireNonNull(urls, "URLs list is required");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("urls", urls);
        if (options != null) {
            mergeOptions(body, options);
        }
        return http.post("/v1/batch/scrape", body, BatchScrapeResponse.class);
    }

    /**
     * Gets the status and results of a batch scrape job.
     *
     * @param jobId the batch scrape job ID
     * @return the batch scrape job status
     */
    public BatchScrapeJob getBatchScrapeStatus(String jobId) {
        Objects.requireNonNull(jobId, "Job ID is required");
        return http.get("/v1/batch/scrape/" + jobId, BatchScrapeJob.class);
    }

    /**
     * Batch-scrapes URLs and waits for completion (auto-polling).
     *
     * @param urls    the URLs to scrape
     * @param options batch scrape configuration options
     * @return the completed batch scrape job with all documents
     */
    public BatchScrapeJob batchScrape(List<String> urls, BatchScrapeOptions options) {
        return batchScrape(urls, options, DEFAULT_POLL_INTERVAL, DEFAULT_JOB_TIMEOUT);
    }

    /**
     * Batch-scrapes URLs and waits for completion with custom polling settings.
     *
     * @param urls           the URLs to scrape
     * @param options        batch scrape configuration options
     * @param pollIntervalSec seconds between status checks
     * @param timeoutSec     maximum seconds to wait
     * @return the completed batch scrape job with all documents
     */
    public BatchScrapeJob batchScrape(List<String> urls, BatchScrapeOptions options,
                                       int pollIntervalSec, int timeoutSec) {
        BatchScrapeResponse start = startBatchScrape(urls, options);
        return pollBatchScrape(start.getId(), pollIntervalSec, timeoutSec);
    }

    /**
     * Cancels a running batch scrape job.
     *
     * @param jobId the batch scrape job ID
     * @return the cancellation response
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> cancelBatchScrape(String jobId) {
        Objects.requireNonNull(jobId, "Job ID is required");
        return http.delete("/v1/batch/scrape/" + jobId, Map.class);
    }

    // ================================================================
    // MAP
    // ================================================================

    /**
     * Discovers URLs on a website.
     *
     * @param url the URL to map
     * @return the discovered URLs
     */
    public MapData map(String url) {
        return map(url, null);
    }

    /**
     * Discovers URLs on a website with options.
     *
     * @param url     the URL to map
     * @param options map configuration options
     * @return the discovered URLs
     */
    public MapData map(String url, MapOptions options) {
        Objects.requireNonNull(url, "URL is required");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("url", url);
        if (options != null) {
            mergeOptions(body, options);
        }
        return extractData(http.post("/v1/map", body, Map.class), MapData.class);
    }

    // ================================================================
    // SEARCH
    // ================================================================

    /**
     * Performs a web search.
     *
     * @param query the search query
     * @return search results
     */
    public SearchData search(String query) {
        return search(query, null);
    }

    /**
     * Performs a web search with options.
     *
     * @param query   the search query
     * @param options search configuration options
     * @return search results
     */
    public SearchData search(String query, SearchOptions options) {
        Objects.requireNonNull(query, "Query is required");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("query", query);
        if (options != null) {
            mergeOptions(body, options);
        }
        return extractData(http.post("/v1/search", body, Map.class), SearchData.class);
    }

    // ================================================================
    // EXTRACT
    // ================================================================

    /**
     * Starts an async extract job.
     *
     * @param options extract configuration options
     * @return the extract response with job ID
     */
    public ExtractResponse startExtract(ExtractOptions options) {
        Objects.requireNonNull(options, "Extract options are required");
        return http.post("/v1/extract", options, ExtractResponse.class);
    }

    /**
     * Gets the status of an extract job.
     *
     * @param jobId the extract job ID
     * @return the extract response
     */
    public ExtractResponse getExtractStatus(String jobId) {
        Objects.requireNonNull(jobId, "Job ID is required");
        return http.get("/v1/extract/" + jobId, ExtractResponse.class);
    }

    /**
     * Runs an extract job and waits for completion (auto-polling).
     *
     * @param options extract configuration options
     * @return the completed extract response
     */
    public ExtractResponse extract(ExtractOptions options) {
        return extract(options, DEFAULT_POLL_INTERVAL, DEFAULT_JOB_TIMEOUT);
    }

    /**
     * Runs an extract job and waits for completion with custom polling settings.
     *
     * @param options         extract configuration options
     * @param pollIntervalSec seconds between status checks
     * @param timeoutSec      maximum seconds to wait
     * @return the completed extract response
     */
    public ExtractResponse extract(ExtractOptions options, int pollIntervalSec, int timeoutSec) {
        ExtractResponse start = startExtract(options);
        if (start.getId() == null) {
            return start;
        }
        long deadline = System.currentTimeMillis() + (timeoutSec * 1000L);
        while (System.currentTimeMillis() < deadline) {
            ExtractResponse status = getExtractStatus(start.getId());
            if (status.isDone()) {
                return status;
            }
            sleep(pollIntervalSec);
        }
        throw new JobTimeoutException(start.getId(), timeoutSec, "Extract");
    }

    // ================================================================
    // AGENT
    // ================================================================

    /**
     * Starts an async agent task.
     *
     * @param options agent configuration options
     * @return the agent response with job ID
     */
    public AgentResponse startAgent(AgentOptions options) {
        Objects.requireNonNull(options, "Agent options are required");
        return http.post("/v1/agent", options, AgentResponse.class);
    }

    /**
     * Gets the status of an agent task.
     *
     * @param jobId the agent job ID
     * @return the agent status response
     */
    public AgentStatusResponse getAgentStatus(String jobId) {
        Objects.requireNonNull(jobId, "Job ID is required");
        return http.get("/v1/agent/" + jobId, AgentStatusResponse.class);
    }

    /**
     * Runs an agent task and waits for completion (auto-polling).
     *
     * @param options agent configuration options
     * @return the completed agent status response
     */
    public AgentStatusResponse agent(AgentOptions options) {
        return agent(options, DEFAULT_POLL_INTERVAL, DEFAULT_JOB_TIMEOUT);
    }

    /**
     * Runs an agent task and waits for completion with custom polling settings.
     *
     * @param options         agent configuration options
     * @param pollIntervalSec seconds between status checks
     * @param timeoutSec      maximum seconds to wait
     * @return the completed agent status response
     */
    public AgentStatusResponse agent(AgentOptions options, int pollIntervalSec, int timeoutSec) {
        AgentResponse start = startAgent(options);
        if (start.getId() == null) {
            throw new FirecrawlException("Agent start did not return a job ID");
        }
        long deadline = System.currentTimeMillis() + (timeoutSec * 1000L);
        while (System.currentTimeMillis() < deadline) {
            AgentStatusResponse status = getAgentStatus(start.getId());
            if (status.isDone()) {
                return status;
            }
            sleep(pollIntervalSec);
        }
        throw new JobTimeoutException(start.getId(), timeoutSec, "Agent");
    }

    /**
     * Cancels a running agent task.
     *
     * @param jobId the agent job ID
     * @return the cancellation response
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> cancelAgent(String jobId) {
        Objects.requireNonNull(jobId, "Job ID is required");
        return http.delete("/v1/agent/" + jobId, Map.class);
    }

    // ================================================================
    // USAGE & METRICS
    // ================================================================

    /**
     * Gets current concurrency usage.
     */
    public ConcurrencyCheck getConcurrency() {
        return http.get("/v1/concurrency", ConcurrencyCheck.class);
    }

    /**
     * Gets current credit usage.
     */
    public CreditUsage getCreditUsage() {
        return http.get("/v1/credits", CreditUsage.class);
    }

    // ================================================================
    // ASYNC CONVENIENCE METHODS
    // ================================================================

    /**
     * Asynchronously scrapes a URL.
     *
     * @param url     the URL to scrape
     * @param options scrape configuration options
     * @return a CompletableFuture that resolves to the scraped Document
     */
    public CompletableFuture<Document> scrapeAsync(String url, ScrapeOptions options) {
        return CompletableFuture.supplyAsync(() -> scrape(url, options), asyncExecutor);
    }

    /**
     * Asynchronously crawls a website and waits for completion.
     *
     * @param url     the URL to crawl
     * @param options crawl configuration options
     * @return a CompletableFuture that resolves to the completed CrawlJob
     */
    public CompletableFuture<CrawlJob> crawlAsync(String url, CrawlOptions options) {
        return CompletableFuture.supplyAsync(() -> crawl(url, options), asyncExecutor);
    }

    /**
     * Asynchronously crawls with custom polling settings.
     *
     * @param url            the URL to crawl
     * @param options        crawl configuration options
     * @param pollIntervalSec seconds between status checks
     * @param timeoutSec     maximum seconds to wait
     * @return a CompletableFuture that resolves to the completed CrawlJob
     */
    public CompletableFuture<CrawlJob> crawlAsync(String url, CrawlOptions options,
                                                    int pollIntervalSec, int timeoutSec) {
        return CompletableFuture.supplyAsync(() -> crawl(url, options, pollIntervalSec, timeoutSec), asyncExecutor);
    }

    /**
     * Asynchronously batch-scrapes URLs and waits for completion.
     *
     * @param urls    the URLs to scrape
     * @param options batch scrape configuration options
     * @return a CompletableFuture that resolves to the completed BatchScrapeJob
     */
    public CompletableFuture<BatchScrapeJob> batchScrapeAsync(List<String> urls, BatchScrapeOptions options) {
        return CompletableFuture.supplyAsync(() -> batchScrape(urls, options), asyncExecutor);
    }

    /**
     * Asynchronously runs a search.
     *
     * @param query   the search query
     * @param options search configuration options
     * @return a CompletableFuture that resolves to the SearchData
     */
    public CompletableFuture<SearchData> searchAsync(String query, SearchOptions options) {
        return CompletableFuture.supplyAsync(() -> search(query, options), asyncExecutor);
    }

    /**
     * Asynchronously runs a map operation.
     *
     * @param url     the URL to map
     * @param options map configuration options
     * @return a CompletableFuture that resolves to the MapData
     */
    public CompletableFuture<MapData> mapAsync(String url, MapOptions options) {
        return CompletableFuture.supplyAsync(() -> map(url, options), asyncExecutor);
    }

    /**
     * Asynchronously runs an extract job and waits for completion.
     *
     * @param options extract configuration options
     * @return a CompletableFuture that resolves to the ExtractResponse
     */
    public CompletableFuture<ExtractResponse> extractAsync(ExtractOptions options) {
        return CompletableFuture.supplyAsync(() -> extract(options), asyncExecutor);
    }

    /**
     * Asynchronously runs an agent task and waits for completion.
     *
     * @param options agent configuration options
     * @return a CompletableFuture that resolves to the AgentStatusResponse
     */
    public CompletableFuture<AgentStatusResponse> agentAsync(AgentOptions options) {
        return CompletableFuture.supplyAsync(() -> agent(options), asyncExecutor);
    }

    // ================================================================
    // INTERNAL POLLING HELPERS
    // ================================================================

    private CrawlJob pollCrawl(String jobId, int pollIntervalSec, int timeoutSec) {
        long deadline = System.currentTimeMillis() + (timeoutSec * 1000L);
        while (System.currentTimeMillis() < deadline) {
            CrawlJob job = getCrawlStatus(jobId);
            if (job.isDone()) {
                return paginateCrawl(job);
            }
            sleep(pollIntervalSec);
        }
        throw new JobTimeoutException(jobId, timeoutSec, "Crawl");
    }

    private BatchScrapeJob pollBatchScrape(String jobId, int pollIntervalSec, int timeoutSec) {
        long deadline = System.currentTimeMillis() + (timeoutSec * 1000L);
        while (System.currentTimeMillis() < deadline) {
            BatchScrapeJob job = getBatchScrapeStatus(jobId);
            if (job.isDone()) {
                return paginateBatchScrape(job);
            }
            sleep(pollIntervalSec);
        }
        throw new JobTimeoutException(jobId, timeoutSec, "Batch scrape");
    }

    /**
     * Auto-paginates crawl results by following the "next" cursor.
     */
    private CrawlJob paginateCrawl(CrawlJob job) {
        CrawlJob current = job;
        while (current.getNext() != null && !current.getNext().isEmpty()) {
            CrawlJob nextPage = http.getAbsolute(current.getNext(), CrawlJob.class);
            if (nextPage.getData() != null && !nextPage.getData().isEmpty()) {
                job.getData().addAll(nextPage.getData());
            }
            current = nextPage;
        }
        return job;
    }

    /**
     * Auto-paginates batch scrape results by following the "next" cursor.
     */
    private BatchScrapeJob paginateBatchScrape(BatchScrapeJob job) {
        BatchScrapeJob current = job;
        while (current.getNext() != null && !current.getNext().isEmpty()) {
            BatchScrapeJob nextPage = http.getAbsolute(current.getNext(), BatchScrapeJob.class);
            if (nextPage.getData() != null && !nextPage.getData().isEmpty()) {
                job.getData().addAll(nextPage.getData());
            }
            current = nextPage;
        }
        return job;
    }

    // ================================================================
    // INTERNAL UTILITIES
    // ================================================================

    /**
     * Extracts the "data" field from a raw API response map and deserializes it.
     */
    @SuppressWarnings("unchecked")
    private <T> T extractData(Map rawResponse, Class<T> type) {
        Object data = rawResponse.get("data");
        if (data == null) {
            // Some endpoints return the data at the top level
            return http.objectMapper.convertValue(rawResponse, type);
        }
        return http.objectMapper.convertValue(data, type);
    }

    /**
     * Merges a typed options object into a request body map, using Jackson serialization.
     */
    @SuppressWarnings("unchecked")
    private void mergeOptions(Map<String, Object> body, Object options) {
        Map<String, Object> optionsMap = http.objectMapper.convertValue(options, Map.class);
        body.putAll(optionsMap);
    }

    private void sleep(int seconds) {
        try {
            Thread.sleep(seconds * 1000L);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new FirecrawlException("Polling interrupted", e);
        }
    }

    // ================================================================
    // BUILDER
    // ================================================================

    public static final class Builder {

        private String apiKey;
        private String apiUrl = DEFAULT_API_URL;
        private long timeoutMs = DEFAULT_TIMEOUT_MS;
        private int maxRetries = DEFAULT_MAX_RETRIES;
        private double backoffFactor = DEFAULT_BACKOFF_FACTOR;
        private Executor asyncExecutor;

        private Builder() {}

        /**
         * Sets the API key. Falls back to FIRECRAWL_API_KEY env var or
         * firecrawl.apiKey system property if not provided.
         */
        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        /**
         * Sets the API base URL. Defaults to https://api.firecrawl.dev.
         * Falls back to FIRECRAWL_API_URL env var if not provided.
         */
        public Builder apiUrl(String apiUrl) {
            this.apiUrl = apiUrl;
            return this;
        }

        /**
         * Sets the HTTP request timeout in milliseconds. Default: 300000 (5 minutes).
         */
        public Builder timeoutMs(long timeoutMs) {
            this.timeoutMs = timeoutMs;
            return this;
        }

        /**
         * Sets the maximum number of automatic retries for transient failures. Default: 3.
         */
        public Builder maxRetries(int maxRetries) {
            this.maxRetries = maxRetries;
            return this;
        }

        /**
         * Sets the exponential backoff factor in seconds. Default: 0.5.
         */
        public Builder backoffFactor(double backoffFactor) {
            this.backoffFactor = backoffFactor;
            return this;
        }

        /**
         * Sets a custom executor for async operations. Default: ForkJoinPool.commonPool().
         */
        public Builder asyncExecutor(Executor asyncExecutor) {
            this.asyncExecutor = asyncExecutor;
            return this;
        }

        public FirecrawlClient build() {
            String resolvedKey = apiKey;
            if (resolvedKey == null || resolvedKey.isEmpty()) {
                resolvedKey = System.getenv("FIRECRAWL_API_KEY");
            }
            if (resolvedKey == null || resolvedKey.isEmpty()) {
                resolvedKey = System.getProperty("firecrawl.apiKey");
            }
            if (resolvedKey == null || resolvedKey.isEmpty()) {
                throw new FirecrawlException(
                        "API key is required. Set it via builder.apiKey(), " +
                        "FIRECRAWL_API_KEY environment variable, or firecrawl.apiKey system property.");
            }

            String resolvedUrl = apiUrl;
            if (resolvedUrl == null || resolvedUrl.equals(DEFAULT_API_URL)) {
                String envUrl = System.getenv("FIRECRAWL_API_URL");
                if (envUrl != null && !envUrl.isEmpty()) {
                    resolvedUrl = envUrl;
                }
            }

            Executor executor = asyncExecutor != null ? asyncExecutor : ForkJoinPool.commonPool();
            FirecrawlHttpClient http = new FirecrawlHttpClient(
                    resolvedKey, resolvedUrl, timeoutMs, maxRetries, backoffFactor);
            return new FirecrawlClient(http, executor);
        }
    }
}
