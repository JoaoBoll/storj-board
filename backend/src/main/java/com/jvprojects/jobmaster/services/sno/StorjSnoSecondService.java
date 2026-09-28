package com.jvprojects.jobmaster.services.sno;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jvprojects.jobmaster.config.Configurations;
import com.jvprojects.jobmaster.dto.StorjSnoDto;
import com.jvprojects.jobmaster.entities.BandwidthDaily;
import com.jvprojects.jobmaster.entities.StorjNode;
import com.jvprojects.jobmaster.entities.StorjSatellites;
import com.jvprojects.jobmaster.entities.StorjSnoSecond;
import com.jvprojects.jobmaster.repositories.StorjNodeRepository;
import com.jvprojects.jobmaster.repositories.sno.StorjSnoSecondRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Service
public class StorjSnoSecondService {

    private static final Logger log = LoggerFactory.getLogger(StorjSnoSecondService.class);

    private final StorjSnoSecondRepository storjSnoSecondRepository;
    private final StorjNodeRepository storjNodeRepository;
    private final Configurations configurations;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate;
    private final List<String> urls;

    public StorjSnoSecondService(StorjSnoSecondRepository storjSnoSecondRepository, StorjNodeRepository storjNodeRepository,
                                Configurations configurations, RestTemplate restTemplate) {
        this.storjSnoSecondRepository = storjSnoSecondRepository;
        this.storjNodeRepository = storjNodeRepository;
        this.configurations = configurations;
        this.restTemplate = restTemplate;
        this.urls = configurations.getUrls();
    }

    @Transactional
    public void runJob() {

        List<StorjSnoDto> items = fetchStorjNodes();
        saveAll(items);

    }

    public List<StorjSnoDto> fetchStorjNodes() {
        log.info("Fetching Storj Satellites data...");
        List<CompletableFuture<StorjSnoDto>> futures = urls.stream()
                .map(url -> CompletableFuture.supplyAsync(() -> consultNode(url)))
                .collect(Collectors.toList());

        return futures.stream()
                .map(CompletableFuture::join)
                .filter(dto -> dto != null)
                .collect(Collectors.toList());
    }

    private StorjSnoDto consultNode(String url) {
        try {
            String json = restTemplate.getForObject(url + "/api/sno/", String.class);
            StorjSnoDto dto = objectMapper.readValue(json, StorjSnoDto.class);
            dto.setUrl(url);
            log.info("✅ Success: {}", url);
            return dto;
        } catch (Exception e) {
            log.error("❌ Fail {}: {}", url, e.getMessage(), e);
            return null;
        }
    }

    public void saveAll(List<StorjSnoDto> itens) {

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

        log.info("Current time in UTC: " + now);

        for (StorjSnoDto item : itens) {
            try {
                saveOne(item, now);
            } catch (Exception e) {
                log.error("Failed to save SNO second snapshot for {}: {}", item.getUrl(), e.getMessage(), e);
            }
        }
    }

    private void saveOne(StorjSnoDto item, OffsetDateTime now) {
        StorjSnoSecond second = new StorjSnoSecond();

        second.setCreatedAt(now);
        if (item.getNodeId() != null) {
            second.setNodeId(item.getNodeId());
        }

        if (item.getDiskSpace() != null) {
            second.setUsedDiskSpace(item.getDiskSpace().getUsed());
            second.setTrashDiskSpace(item.getDiskSpace().getTrash());
            second.setOverusedDiskSpace(item.getDiskSpace().getOverused());
        }

        if (item.getBandwidth() != null) {
            second.setUsedBandwidth(item.getBandwidth().getUsed());
        }

        applySatelliteSnapshot(second);

        storjSnoSecondRepository.save(second);
    }

    /**
     * The satellites endpoint only refreshes once a minute and only reports ingress/egress at
     * daily granularity, so every 5s tick just re-reads the node's latest known snapshot -
     * this keeps ingress/egress/uptime living on the same row as everything else, and lets
     * the whole StorjSno cascade (minute -> month) carry them forward like any other field.
     * Relies on runJob()'s @Transactional to keep the session open for these lazy collections
     * (this whole chain runs on a Quartz job thread, with no web request to piggy-back on).
     */
    private void applySatelliteSnapshot(StorjSnoSecond second) {
        if (second.getNodeId() == null) return;
        StorjNode node = storjNodeRepository.findByNodeId(second.getNodeId());
        StorjSatellites satellites = node == null ? null : node.getStorjSatellites();
        if (satellites == null) return;

        // Set estimated payout early if available
        if (node != null && node.getStorjEstimatedPayout() != null) {
            com.jvprojects.jobmaster.entities.StorjEstimatedPayout estimatedPayout = node.getStorjEstimatedPayout();
            if (estimatedPayout.getCurrentMonthExpectations() != null) {
                second.setEstimatedPayout(estimatedPayout.getCurrentMonthExpectations());
            }
            if (estimatedPayout.getCurrentMonth() != null && estimatedPayout.getCurrentMonth().getPayout() != null) {
                second.setCurrentMonthPayout(estimatedPayout.getCurrentMonth().getPayout());
            }
        }

        List<BandwidthDaily> bandwidthDaily = satellites.getBandwidthDaily();
        if (bandwidthDaily != null && !bandwidthDaily.isEmpty()) {
            OffsetDateTime latestDay = bandwidthDaily.stream()
                    .filter(item -> item.getIntervalStart() != null)
                    .map(item -> item.getIntervalStart().truncatedTo(ChronoUnit.DAYS))
                    .max(Comparator.naturalOrder())
                    .orElse(null);
            if (latestDay != null) {
                long ingress = bandwidthDaily.stream()
                        .filter(item -> item.getIntervalStart() != null && item.getIntervalStart().truncatedTo(ChronoUnit.DAYS).isEqual(latestDay))
                        .mapToLong(item -> value(item.getIngressRepair()) + value(item.getIngressUsage()))
                        .sum();
                long egress = bandwidthDaily.stream()
                        .filter(item -> item.getIntervalStart() != null && item.getIntervalStart().truncatedTo(ChronoUnit.DAYS).isEqual(latestDay))
                        .mapToLong(item -> value(item.getEgressRepair()) + value(item.getEgressAudit()) + value(item.getEgressUsage()))
                        .sum();
                second.setIngressTotal(ingress);
                second.setEgressTotal(egress);
            }
        }

        List<BigDecimal> scores = satellites.getAudits() == null
                ? List.of()
                : satellites.getAudits().stream().map(com.jvprojects.jobmaster.entities.Audits::getOnlineScore).filter(Objects::nonNull).toList();
        second.setUptimeScoreSum(scores.stream().mapToDouble(BigDecimal::doubleValue).sum() * 100);
        second.setUptimeScoreCount(scores.size());
    }

    private long value(Long value) {
        return value == null ? 0 : value;
    }
}
