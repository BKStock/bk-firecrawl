package com.firecrawl.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/**
 * Search results from a web search.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class SearchData {

    private List<Map<String, Object>> web;
    private List<Map<String, Object>> news;
    private List<Map<String, Object>> images;

    /** Web search results. Each entry may be a simple result or a full Document (if scrapeOptions provided). */
    public List<Map<String, Object>> getWeb() { return web; }

    /** News search results. */
    public List<Map<String, Object>> getNews() { return news; }

    /** Image search results. */
    public List<Map<String, Object>> getImages() { return images; }

    @Override
    public String toString() {
        int w = web != null ? web.size() : 0;
        int n = news != null ? news.size() : 0;
        int i = images != null ? images.size() : 0;
        return "SearchData{web=" + w + ", news=" + n + ", images=" + i + "}";
    }
}
