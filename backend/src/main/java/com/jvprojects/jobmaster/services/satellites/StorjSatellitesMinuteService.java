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

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Service
public class StorjSatellitesMinuteService {

    private static final Logger log = LoggerFactory.getLogger(StorjSnoSecondService.class);

    private final Configurations configurations;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<String> urls;

    private StorjNodeRepository storjNodeRepository;
    private StorjSatellitesRepository storjSatellitesRepository;

    public StorjSatellitesMinuteService(Configurations configurations, StorjNodeRepository storjNodeRepository, StorjSatellitesRepository storjSatellitesRepository) {
        this.configurations = configurations;
        this.urls = configurations.getUrls();
        this.storjNodeRepository = storjNodeRepository;
        this.storjSatellitesRepository = storjSatellitesRepository;
    }

    public void saveAll(List<StorjSatellitesDto> itens) {

        for (StorjSatellitesDto item : itens) {

            StorjNode storjNode = storjNodeRepository.findByUrl(item.getUlr());

            StorjSatellites satellite = storjSatellitesRepository.findByStorjNodeId(storjNode.getId());

            if (satellite == null) {
                satellite = new StorjSatellites();
                satellite.setStorjNode(storjNode);
            }

            //StorageDaily
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

            //BandwidthDaily
            List<BandwidthDaily> bandwidthDailyList = new ArrayList<>();

            for (StorjSatellitesDto.BandwidthDaily band : item.getBandwidthDaily()) {
                BandwidthDaily bandwidthDaily = new BandwidthDaily(band);

                bandwidthDaily.setStorjSatellite(satellite);
                bandwidthDailyList.add(bandwidthDaily);
            }

            satellite.setBandwidthDaily(bandwidthDailyList);

            //Audits
            List<Audits> audits = new ArrayList<>();

            for (StorjSatellitesDto.Audit audit : item.getAudits()) {
                Audits aud =  new Audits(audit);

                aud.setStorjSatellite(satellite);
                audits.add(aud);
            }

            satellite.setAudits(audits);

            satellite.setStorageSummary(item.getStorageSummary());
            satellite.setAverageUsageBytes(item.getAverageUsageBytes());
            satellite.setBandwidthSummary(item.getBandwidthSummary());
            satellite.setEgressSummary(item.getEgressSummary());
            satellite.setIngressSummary(item.getIngressSummary());
            satellite.setEarliestJoinedAt(OffsetDateTime.parse(item.getEarliestJoinedAt()));

            storjSatellitesRepository.save(satellite);
        }

    }
}
