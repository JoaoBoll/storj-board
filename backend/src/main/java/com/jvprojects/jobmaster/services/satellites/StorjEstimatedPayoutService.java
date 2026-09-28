package com.jvprojects.jobmaster.services.satellites;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jvprojects.jobmaster.config.Configurations;
import com.jvprojects.jobmaster.dto.EstimatedPayoutDTO;
import com.jvprojects.jobmaster.entities.MonthData;
import com.jvprojects.jobmaster.entities.StorjEstimatedPayout;
import com.jvprojects.jobmaster.entities.StorjNode;
import com.jvprojects.jobmaster.repositories.StorjEstimatedPayoutRepository;
import com.jvprojects.jobmaster.repositories.StorjNodeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Service
public class StorjEstimatedPayoutService {

    private static final Logger log = LoggerFactory.getLogger(StorjEstimatedPayoutService.class);

    private final Configurations configurations;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate;
    private final List<String> urls;

    private final StorjNodeRepository storjNodeRepository;
    private final StorjEstimatedPayoutRepository storjEstimatedPayoutRepository;

    public StorjEstimatedPayoutService(Configurations configurations, StorjNodeRepository storjNodeRepository,
                                        StorjEstimatedPayoutRepository storjEstimatedPayoutRepository, RestTemplate restTemplate) {
        this.configurations = configurations;
        this.urls = configurations.getUrls();
        this.storjNodeRepository = storjNodeRepository;
        this.storjEstimatedPayoutRepository = storjEstimatedPayoutRepository;
        this.restTemplate = restTemplate;
    }

    public List<EstimatedPayoutDTO> fetchEstimatedPayouts() {
        log.info("Fetching Storj estimated payout data...");
        List<CompletableFuture<EstimatedPayoutDTO>> futures = urls.stream()
                .map(url -> CompletableFuture.supplyAsync(() -> consultNode(url)))
                .collect(Collectors.toList());

        return futures.stream()
                .map(CompletableFuture::join)
                .filter(dto -> dto != null)
                .collect(Collectors.toList());
    }

    private EstimatedPayoutDTO consultNode(String url) {
        try {
            String json = restTemplate.getForObject(url + "/api/sno/estimated-payout", String.class);
            EstimatedPayoutDTO dto = objectMapper.readValue(json, EstimatedPayoutDTO.class);
            dto.setUrl(url);
            log.info("✅ Success: {}", url);
            return dto;
        } catch (Exception e) {
            log.error("❌ Fail {}: {}", url, e.getMessage(), e);
            return null;
        }
    }

    public void saveAll(List<EstimatedPayoutDTO> items) {
        for (EstimatedPayoutDTO item : items) {
            try {
                saveOne(item);
            } catch (Exception e) {
                log.error("Failed to save estimated payout data for {}: {}", item.getUrl(), e.getMessage(), e);
            }
        }
    }

    private void saveOne(EstimatedPayoutDTO item) {
        StorjNode storjNode = storjNodeRepository.findByUrl(item.getUrl());

        if (storjNode == null) {
            log.warn("No StorjNode registered for url {}, skipping estimated payout save", item.getUrl());
            return;
        }

        StorjEstimatedPayout payout = storjEstimatedPayoutRepository.findByStorjNodeId(storjNode.getId());
        if (payout == null) {
            payout = new StorjEstimatedPayout();
            payout.setStorjNode(storjNode);
        }

        payout.setCurrentMonth(toMonthData(item.getCurrentMonth(), payout.getCurrentMonth()));
        payout.setPreviousMonth(toMonthData(item.getPreviousMonth(), payout.getPreviousMonth()));
        payout.setCurrentMonthExpectations(item.getCurrentMonthExpectations() == null
                ? null
                : java.math.BigDecimal.valueOf(item.getCurrentMonthExpectations()));

        storjEstimatedPayoutRepository.save(payout);
    }

    private MonthData toMonthData(EstimatedPayoutDTO.MonthData source, MonthData existing) {
        if (source == null) return existing;

        MonthData month = existing == null ? new MonthData() : existing;
        month.setEgressBandwidth(source.getEgressBandwidth());
        month.setEgressBandwidthPayout(source.getEgressBandwidthPayout());
        month.setEgressRepairAudit(source.getEgressRepairAudit());
        month.setEgressRepairAuditPayout(source.getEgressRepairAuditPayout());
        month.setDiskSpace(source.getDiskSpace());
        month.setDiskSpacePayout(source.getDiskSpacePayout());
        month.setHeldRate(source.getHeldRate() == null ? null : java.math.BigDecimal.valueOf(source.getHeldRate()));
        month.setPayout(source.getPayout());
        month.setHeld(source.getHeld());
        return month;
    }
}
