package com.firecrawl.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/**
 * Result of a map operation containing discovered URLs.
 * In v2, each link is a MapDocument with url, title, and description.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class MapData {

    private List<Map<String, Object>> links;

    public List<Map<String, Object>> getLinks() { return links; }

    @Override
    public String toString() {
        int count = links != null ? links.size() : 0;
        return "MapData{links=" + count + "}";
    }
}
