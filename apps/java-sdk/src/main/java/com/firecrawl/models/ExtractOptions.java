package com.firecrawl.models;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/**
 * Options for an extract request.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ExtractOptions {

    private List<String> urls;
    private String prompt;
    private Map<String, Object> schema;
    private String systemPrompt;
    private Boolean allowExternalLinks;
    private Boolean enableWebSearch;
    private Boolean showSources;
    private ScrapeOptions scrapeOptions;
    private Boolean ignoreInvalidURLs;
    private String integration;
    private Map<String, Object> agent;

    private ExtractOptions() {}

    public List<String> getUrls() { return urls; }
    public String getPrompt() { return prompt; }
    public Map<String, Object> getSchema() { return schema; }
    public String getSystemPrompt() { return systemPrompt; }
    public Boolean getAllowExternalLinks() { return allowExternalLinks; }
    public Boolean getEnableWebSearch() { return enableWebSearch; }
    public Boolean getShowSources() { return showSources; }
    public ScrapeOptions getScrapeOptions() { return scrapeOptions; }
    public Boolean getIgnoreInvalidURLs() { return ignoreInvalidURLs; }
    public String getIntegration() { return integration; }
    public Map<String, Object> getAgent() { return agent; }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private List<String> urls;
        private String prompt;
        private Map<String, Object> schema;
        private String systemPrompt;
        private Boolean allowExternalLinks;
        private Boolean enableWebSearch;
        private Boolean showSources;
        private ScrapeOptions scrapeOptions;
        private Boolean ignoreInvalidURLs;
        private String integration;
        private Map<String, Object> agent;

        private Builder() {}

        /** URLs to extract data from. */
        public Builder urls(List<String> urls) { this.urls = urls; return this; }
        /** LLM prompt for extraction. */
        public Builder prompt(String prompt) { this.prompt = prompt; return this; }
        /** JSON Schema for structured extraction. */
        public Builder schema(Map<String, Object> schema) { this.schema = schema; return this; }
        /** Custom system prompt. */
        public Builder systemPrompt(String systemPrompt) { this.systemPrompt = systemPrompt; return this; }
        /** Follow external links. */
        public Builder allowExternalLinks(Boolean allowExternalLinks) { this.allowExternalLinks = allowExternalLinks; return this; }
        /** Enable web search for additional context. */
        public Builder enableWebSearch(Boolean enableWebSearch) { this.enableWebSearch = enableWebSearch; return this; }
        /** Include sources in the response. */
        public Builder showSources(Boolean showSources) { this.showSources = showSources; return this; }
        /** Scrape options for fetching pages. */
        public Builder scrapeOptions(ScrapeOptions scrapeOptions) { this.scrapeOptions = scrapeOptions; return this; }
        /** Ignore invalid URLs. */
        public Builder ignoreInvalidURLs(Boolean ignoreInvalidURLs) { this.ignoreInvalidURLs = ignoreInvalidURLs; return this; }
        /** Integration identifier. */
        public Builder integration(String integration) { this.integration = integration; return this; }
        /** Agent configuration (e.g., {"model": "FIRE-1"}). */
        public Builder agent(Map<String, Object> agent) { this.agent = agent; return this; }

        public ExtractOptions build() {
            ExtractOptions o = new ExtractOptions();
            o.urls = this.urls;
            o.prompt = this.prompt;
            o.schema = this.schema;
            o.systemPrompt = this.systemPrompt;
            o.allowExternalLinks = this.allowExternalLinks;
            o.enableWebSearch = this.enableWebSearch;
            o.showSources = this.showSources;
            o.scrapeOptions = this.scrapeOptions;
            o.ignoreInvalidURLs = this.ignoreInvalidURLs;
            o.integration = this.integration;
            o.agent = this.agent;
            return o;
        }
    }
}
