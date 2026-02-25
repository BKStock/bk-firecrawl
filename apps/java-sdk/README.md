# Firecrawl Java SDK

Java SDK for the [Firecrawl](https://firecrawl.dev) v2 web scraping API.

## Requirements

- Java 11+
- Gradle 8+ (for building from source)

## Installation

### Gradle (Kotlin DSL)

```kotlin
implementation("com.firecrawl:firecrawl-java:1.0.0")
```

### Gradle (Groovy)

```groovy
implementation 'com.firecrawl:firecrawl-java:1.0.0'
```

### Maven

```xml
<dependency>
    <groupId>com.firecrawl</groupId>
    <artifactId>firecrawl-java</artifactId>
    <version>1.0.0</version>
</dependency>
```

## Quick Start

```java
import com.firecrawl.client.FirecrawlClient;
import com.firecrawl.models.*;
import java.util.List;

// Create client
FirecrawlClient client = FirecrawlClient.builder()
    .apiKey("fc-your-api-key")
    .build();

// Or use environment variable
// export FIRECRAWL_API_KEY=fc-your-api-key
FirecrawlClient client = FirecrawlClient.fromEnv();

// Scrape a page
Document doc = client.scrape("https://example.com",
    ScrapeOptions.builder()
        .formats(List.of("markdown"))
        .build());

System.out.println(doc.getMarkdown());
```

## API Reference

### Scrape

Scrape a single URL and get the content in various formats.

```java
Document doc = client.scrape("https://example.com",
    ScrapeOptions.builder()
        .formats(List.of("markdown", "html"))
        .onlyMainContent(true)
        .waitFor(5000)
        .build());

System.out.println(doc.getMarkdown());
System.out.println(doc.getMetadata().get("title"));
```

#### JSON Extraction

```java
import com.firecrawl.models.JsonFormat;

JsonFormat jsonFmt = JsonFormat.builder()
    .prompt("Extract the product name and price")
    .schema(Map.of(
        "type", "object",
        "properties", Map.of(
            "name", Map.of("type", "string"),
            "price", Map.of("type", "number")
        )
    ))
    .build();

Document doc = client.scrape("https://example.com/product",
    ScrapeOptions.builder()
        .formats(List.of(jsonFmt))
        .build());

System.out.println(doc.getJson());
```

### Crawl

Crawl an entire website. The `crawl()` method polls until completion.

```java
// Convenience method — polls until done
CrawlJob job = client.crawl("https://example.com",
    CrawlOptions.builder()
        .limit(50)
        .maxDiscoveryDepth(3)
        .scrapeOptions(ScrapeOptions.builder()
            .formats(List.of("markdown"))
            .build())
        .build());

for (Document doc : job.getData()) {
    System.out.println(doc.getMetadata().get("sourceURL"));
}
```

#### Async Crawl (manual polling)

```java
CrawlResponse start = client.startCrawl("https://example.com",
    CrawlOptions.builder().limit(100).build());

System.out.println("Job started: " + start.getId());

// Poll manually
CrawlJob status;
do {
    Thread.sleep(2000);
    status = client.getCrawlStatus(start.getId());
    System.out.println(status.getCompleted() + "/" + status.getTotal());
} while (!status.isDone());
```

### Batch Scrape

Scrape multiple URLs in parallel.

```java
BatchScrapeJob job = client.batchScrape(
    List.of("https://example.com", "https://example.org"),
    BatchScrapeOptions.builder()
        .options(ScrapeOptions.builder()
            .formats(List.of("markdown"))
            .build())
        .build());

for (Document doc : job.getData()) {
    System.out.println(doc.getMarkdown());
}
```

### Map

Discover all URLs on a website.

```java
MapData data = client.map("https://example.com",
    MapOptions.builder()
        .limit(100)
        .search("blog")
        .build());

for (Map<String, Object> link : data.getLinks()) {
    System.out.println(link.get("url") + " - " + link.get("title"));
}
```

### Search

Search the web and optionally scrape results.

```java
SearchData results = client.search("firecrawl web scraping",
    SearchOptions.builder()
        .limit(10)
        .build());

if (results.getWeb() != null) {
    for (Map<String, Object> result : results.getWeb()) {
        System.out.println(result.get("title") + " — " + result.get("url"));
    }
}
```

### Extract

Extract structured data from web pages using LLM.

```java
ExtractResponse result = client.extract(
    ExtractOptions.builder()
        .urls(List.of("https://example.com"))
        .prompt("Extract the main heading and first paragraph")
        .schema(Map.of(
            "type", "object",
            "properties", Map.of(
                "heading", Map.of("type", "string"),
                "paragraph", Map.of("type", "string")
            )
        ))
        .build());

System.out.println(result.getData());
```

### Agent

Run an AI-powered agent to research and extract data from the web.

```java
AgentStatusResponse result = client.agent(
    AgentOptions.builder()
        .prompt("Find the pricing plans for Firecrawl and compare them")
        .build());

System.out.println(result.getData());
```

### Usage & Metrics

```java
ConcurrencyCheck conc = client.getConcurrency();
System.out.println("Concurrency: " + conc.getConcurrency() + "/" + conc.getMaxConcurrency());

CreditUsage credits = client.getCreditUsage();
System.out.println("Remaining credits: " + credits.getRemainingCredits());
```

## Async Support

All methods have async variants that return `CompletableFuture`:

```java
import java.util.concurrent.CompletableFuture;

CompletableFuture<Document> future = client.scrapeAsync(
    "https://example.com",
    ScrapeOptions.builder().formats(List.of("markdown")).build());

future.thenAccept(doc -> System.out.println(doc.getMarkdown()));
```

## Error Handling

The SDK throws unchecked exceptions:

```java
import com.firecrawl.errors.*;

try {
    Document doc = client.scrape("https://example.com");
} catch (AuthenticationException e) {
    // 401 — invalid API key
    System.err.println("Auth failed: " + e.getMessage());
} catch (RateLimitException e) {
    // 429 — too many requests
    System.err.println("Rate limited: " + e.getMessage());
} catch (JobTimeoutException e) {
    // Async job timed out
    System.err.println("Job " + e.getJobId() + " timed out after " + e.getTimeoutSeconds() + "s");
} catch (FirecrawlException e) {
    // All other API errors
    System.err.println("Error " + e.getStatusCode() + ": " + e.getMessage());
}
```

## Configuration

```java
FirecrawlClient client = FirecrawlClient.builder()
    .apiKey("fc-your-api-key")            // Required (or set FIRECRAWL_API_KEY env var)
    .apiUrl("https://api.firecrawl.dev")  // Optional (or set FIRECRAWL_API_URL env var)
    .timeoutMs(300_000)                   // HTTP timeout: 5 min default
    .maxRetries(3)                        // Auto-retries for transient failures
    .backoffFactor(0.5)                   // Exponential backoff factor (seconds)
    .asyncExecutor(myExecutor)            // Custom executor for async methods
    .build();
```

## Building from Source

```bash
cd apps/java-sdk
./gradlew build
```

## Running Tests

Unit tests run without any configuration:

```bash
./gradlew test
```

E2E tests require a valid API key:

```bash
FIRECRAWL_API_KEY=fc-xxx ./gradlew test
```
