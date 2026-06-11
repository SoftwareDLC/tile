| Fixture | Variant | Model | Cases | Accuracy | Avg list F1 | Avg latency ms | Avg API input tokens | Avg API output tokens |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
OpenStreetMap extract | Compact JSON | gpt-5.4-mini | 3 | 0.0% | 85.5% | 10,265 | 50,626 | 103
OpenStreetMap extract | TILE normalized | gpt-5.4-mini | 3 | 0.0% | 86.3% | 16,152 | 53,060 | 97
OpenStreetMap extract | TILE first-class relational | gpt-5.4-mini | 3 | 0.0% | 93.1% | 1,197 | 3,254 | 103
OpenStreetMap extract | TILE first-class embedded | gpt-5.4-mini | 3 | 33.3% | 94.7% | 1,209 | 4,142 | 99
Wikidata truthy triples | Compact JSON | gpt-5.4-mini | 3 | 0.0% | 78.2% | 15,782 | 58,149 | 25
Wikidata truthy triples | TILE normalized | gpt-5.4-mini | 3 | 0.0% | 73.8% | 12,392 | 38,639 | 15
Wikidata truthy triples | TILE first-class relational | gpt-5.4-mini | 3 | 33.3% | 84.1% | 1,103 | 1,269 | 21
Wikidata truthy triples | TILE first-class embedded | gpt-5.4-mini | 3 | 100.0% | 100.0% | 888 | 813 | 23
MusicBrainz release groups | Compact JSON | gpt-5.4-mini | 3 | 0.0% | 49.1% | 20,027 | 67,012 | 249
MusicBrainz release groups | TILE normalized | gpt-5.4-mini | 3 | 0.0% | 55.9% | 17,196 | 58,611 | 235
MusicBrainz release groups | TILE first-class relational | gpt-5.4-mini | 3 | 0.0% | 70.0% | 2,119 | 2,815 | 240
MusicBrainz release groups | TILE first-class embedded | gpt-5.4-mini | 3 | 0.0% | 61.2% | 1,916 | 2,324 | 250
npm dependency metadata | Compact JSON | gpt-5.4-mini | 3 | 66.7% | 94.1% | 7,112 | 34,611 | 44
npm dependency metadata | TILE normalized | gpt-5.4-mini | 3 | 66.7% | 95.2% | 8,348 | 30,002 | 45
npm dependency metadata | TILE first-class relational | gpt-5.4-mini | 3 | 33.3% | 96.5% | 2,473 | 702 | 55
npm dependency metadata | TILE first-class embedded | gpt-5.4-mini | 3 | 0.0% | 95.8% | 1,817 | 917 | 55
