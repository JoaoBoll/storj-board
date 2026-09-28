package com.jvprojects.jobmaster.services.satellites;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jvprojects.jobmaster.config.Configurations;
import com.jvprojects.jobmaster.dto.StorjSatellitesDto;
import com.jvprojects.jobmaster.entities.*;
import com.jvprojects.jobmaster.repositories.StorjNodeRepository;
import com.jvprojects.jobmaster.repositories.StorjSatellitesRepository;
import com.jvprojects.jobmaster.services.sno.StorjSnoSecondService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Service
public class StorjSatellitesService {

    private static final Logger log = LoggerFactory.getLogger(StorjSnoSecondService.class);

    private final Configurations configurations;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate;
    private final List<String> urls;

    private StorjNodeRepository storjNodeRepository;
    private StorjSatellitesRepository storjSatellitesRepository;

    public StorjSatellitesService(Configurations configurations, StorjNodeRepository storjNodeRepository,
                                 StorjSatellitesRepository storjSatellitesRepository, RestTemplate restTemplate) {
        this.configurations = configurations;
        this.urls = configurations.getUrls();
        this.storjNodeRepository = storjNodeRepository;
        this.storjSatellitesRepository = storjSatellitesRepository;
        this.restTemplate = restTemplate;
    }

    public List<StorjSatellitesDto> fetchStorjSatellites() {
        log.info("Fetching Storj Satellites data...");
        List<CompletableFuture<StorjSatellitesDto>> futures = urls.stream()
                .map(url -> CompletableFuture.supplyAsync(() -> consultNode(url)))
                .collect(Collectors.toList());

        return futures.stream()
                .map(CompletableFuture::join)
                .filter(dto -> dto != null)
                .collect(Collectors.toList());
    }

    private StorjSatellitesDto consultNode(String url) {
        try {
            String json = restTemplate.getForObject(url + "/api/sno/satellites", String.class);
            StorjSatellitesDto dto = objectMapper.readValue(json, StorjSatellitesDto.class);
            dto.setUlr(url);
            log.info("✅ Success: {}", url);
            return dto;
        } catch (Exception e) {
            log.error("❌ Fail {}: {}", url, e.getMessage(), e);
            return null;
        }
    }

    public void saveAll(List<StorjSatellitesDto> itens) {

        for (StorjSatellitesDto item : itens) {
            try {
                saveOne(item);
            } catch (Exception e) {
                log.error("Failed to save satellites data for {}: {}", item.getUlr(), e.getMessage(), e);
            }
        }
    }

    private void saveOne(StorjSatellitesDto item) {
        StorjNode storjNode = storjNodeRepository.findByUrl(item.getUlr());

        if (storjNode == null) {
            log.warn("No StorjNode registered for url {}, skipping satellites save", item.getUlr());
            return;
        }

        StorjSatellites satellite = storjSatellitesRepository.findByStorjNodeId(storjNode.getId());

        if (satellite == null) {
            satellite = new StorjSatellites();
            satellite.setStorjNode(storjNode);
        }

        List<StorageDaily> storageDailyList = new ArrayList<>();
        for (StorjSatellitesDto.StorageDaily daily : item.getStorageDaily()) {
            StorageDaily storageDaily = new StorageDaily();
            storageDaily.setAtRestTotal(daily.getAtRestTotal());
            storageDaily.setAtRestTotalBytes(daily.getAtRestTotalBytes());
            storageDaily.setIntervalStart(OffsetDateTime.parse(daily.getIntervalStart()));
            storageDaily.setStorjSatellite(satellite);
            storageDailyList.add(storageDaily);
        }
        satellite.setStorageDaily(storageDailyList);

        List<BandwidthDaily> bandwidthDailyList = new ArrayList<>();
        for (StorjSatellitesDto.BandwidthDaily band : item.getBandwidthDaily()) {
            BandwidthDaily bandwidthDaily = new BandwidthDaily(band);
            bandwidthDaily.setStorjSatellite(satellite);
            bandwidthDailyList.add(bandwidthDaily);
        }
        satellite.setBandwidthDaily(bandwidthDailyList);

        List<Audits> audits = new ArrayList<>();
        for (StorjSatellitesDto.Audit audit : item.getAudits()) {
            Audits aud = new Audits(audit);
            aud.setStorjSatellite(satellite);
            audits.add(aud);
        }
        satellite.setAudits(audits);

        satellite.setStorageSummary(item.getStorageSummary());
        satellite.setAverageUsageBytes(item.getAverageUsageBytes());
        satellite.setBandwidthSummary(item.getBandwidthSummary());
        satellite.setEgressSummary(item.getEgressSummary());
        satellite.setIngressSummary(item.getIngressSummary());
        if (item.getEarliestJoinedAt() != null) {
            satellite.setEarliestJoinedAt(OffsetDateTime.parse(item.getEarliestJoinedAt()));
        }

        storjSatellitesRepository.save(satellite);
    }
}
