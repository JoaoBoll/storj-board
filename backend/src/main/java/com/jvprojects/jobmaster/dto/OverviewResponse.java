package com.jvprojects.jobmaster.dto;

import java.util.List;

public record OverviewResponse(
    String interval,
    int points,
    List<Point> data
) {
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    public record Point(
        String label,
        Long storageUsed,
        Double storagePercentOfFirst,
        Long trashUsed,
        Double trashPercentOfFirst,
        Long ingressTotal,
        Long egressTotal,
        Long totalBandwidthUsed,
        Double uptimePercent,
        java.math.BigDecimal estimatedPayout,
        java.math.BigDecimal currentMonthPayout
    ) {
    }
}