package com.jvprojects.jobmaster.resources;

import com.jvprojects.jobmaster.repositories.StorjNodeRepository;
import com.jvprojects.jobmaster.repositories.sno.StorjSnoSecondRepository;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ApiControllerTest {

    private final StorjNodeRepository nodes = mock(StorjNodeRepository.class);
    private final StorjSnoSecondRepository samples = mock(StorjSnoSecondRepository.class);
    private final ApiController controller = new ApiController(nodes, samples);

    @Test
    void overviewRequestsOnlyOneSamplePerNodeAndBucket() {
        when(samples.findLatestPerNodeAndBucket(any(), any(), eq(300L))).thenReturn(List.of());

        var response = controller.overview("5m", 31, "bandwidth", null, null);

        assertEquals(31, response.data().size());
        verify(samples).findLatestPerNodeAndBucket(any(), any(), eq(300L));
    }

    @Test
    void overviewRejectsExcessivePointCountsBeforeQuerying() {
        assertThrows(ResponseStatusException.class,
                () -> controller.overview("5m", 0, "all", null, null));
        assertThrows(ResponseStatusException.class,
                () -> controller.overview("5m", 101, "all", null, null));

        verifyNoInteractions(samples);
    }
}
