package br.bookgather.bookservice.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class InstanceController {

    @GetMapping("/instance")
    public Map<String, String> instance() {
        String hostname = System.getenv()
                .getOrDefault("HOSTNAME", "local");

        return Map.of("pod", hostname);
    }
}
