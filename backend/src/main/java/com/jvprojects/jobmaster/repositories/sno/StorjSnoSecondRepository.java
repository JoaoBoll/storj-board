package com.jvprojects.jobmaster.repositories.sno;

import com.jvprojects.jobmaster.entities.StorjSnoSecond;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.UUID;

@Repository
public interface StorjSnoSecondRepository extends JpaRepository<StorjSnoSecond, UUID> {

    // Return only the latest sample for each node in each chart bucket. Loading every
    // five-second sample for a multi-day chart can exhaust the JVM before Java can group it.
    @Query(value = """
            SELECT s.*
            FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY node_id,
                        FLOOR(EXTRACT(EPOCH FROM (created_at - CAST(:start AS timestamptz))) / :stepSeconds)
                    ORDER BY created_at DESC, id DESC
                ) AS row_number
                FROM storj_sno_second
                WHERE created_at >= :start AND created_at < :end
            ) latest
            JOIN storj_sno_second s ON s.id = latest.id
            WHERE latest.row_number = 1
            ORDER BY s.created_at DESC
            """, nativeQuery = true)
    java.util.List<StorjSnoSecond> findLatestPerNodeAndBucket(
            @Param("start") OffsetDateTime start,
            @Param("end") OffsetDateTime end,
            @Param("stepSeconds") long stepSeconds);
    StorjSnoSecond findByNodeId(String nodeId);
    Long countByNodeIdAndCreatedAtBetween(String nodeId, OffsetDateTime startDate, OffsetDateTime endDate);
    StorjSnoSecond findFirstByNodeIdAndCreatedAtBetweenOrderByCreatedAtAsc(String nodeId, OffsetDateTime startDate, OffsetDateTime endDate);
    StorjSnoSecond findFirstByNodeIdOrderByCreatedAtAsc(String nodeId);
    StorjSnoSecond findFirstByNodeIdAndCreatedAtBetweenOrderByCreatedAtDesc(String nodeId, OffsetDateTime startDate, OffsetDateTime endDate);
    StorjSnoSecond findFirstByNodeIdOrderByCreatedAtDesc(String nodeId);

}
