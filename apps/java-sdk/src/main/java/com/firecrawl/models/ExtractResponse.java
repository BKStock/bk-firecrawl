package com.firecrawl.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

/**
 * Response from an extract operation.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ExtractResponse {

    private Boolean success;
    private String id;
    private String status;
    private Object data;
    private String error;
    private String warning;
    private Map<String, Object> sources;
    private String expiresAt;
    private Integer creditsUsed;

    public Boolean getSuccess() { return success; }
    public String getId() { return id; }
    public String getStatus() { return status; }
    public Object getData() { return data; }
    public String getError() { return error; }
    public String getWarning() { return warning; }
    public Map<String, Object> getSources() { return sources; }
    public String getExpiresAt() { return expiresAt; }
    public Integer getCreditsUsed() { return creditsUsed; }

    public boolean isDone() {
        return "completed".equals(status) || "failed".equals(status) || "cancelled".equals(status);
    }

    @Override
    public String toString() {
        return "ExtractResponse{id=" + id + ", status=" + status + "}";
    }
}
