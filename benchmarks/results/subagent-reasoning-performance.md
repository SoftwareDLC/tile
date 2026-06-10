## Accuracy by fixture and variant

| Fixture | Variant | Model | Cases | Correct | Accuracy |
| --- | --- | --- | ---: | ---: | ---: |
OpenStreetMap extract | Compact JSON | gpt-5.4-mini | 3 | 3 | 100.0%
Wikidata truthy triples | Compact JSON | gpt-5.4-mini | 3 | 3 | 100.0%
MusicBrainz release groups | Compact JSON | gpt-5.4-mini | 3 | 3 | 100.0%
npm dependency metadata | Compact JSON | gpt-5.4-mini | 3 | 3 | 100.0%
OpenStreetMap extract | Pretty JSON | gpt-5.4-mini | 3 | 3 | 100.0%
Wikidata truthy triples | Pretty JSON | gpt-5.4-mini | 3 | 2 | 66.7%
MusicBrainz release groups | Pretty JSON | gpt-5.4-mini | 3 | 2 | 66.7%
npm dependency metadata | Pretty JSON | gpt-5.4-mini | 3 | 3 | 100.0%
OpenStreetMap extract | TILE path | gpt-5.4-mini | 3 | 3 | 100.0%
Wikidata truthy triples | TILE path | gpt-5.4-mini | 3 | 3 | 100.0%
MusicBrainz release groups | TILE path | gpt-5.4-mini | 3 | 3 | 100.0%
npm dependency metadata | TILE path | gpt-5.4-mini | 3 | 3 | 100.0%
OpenStreetMap extract | TILE normalized | gpt-5.4-mini | 3 | 0 | 0.0%
Wikidata truthy triples | TILE normalized | gpt-5.4-mini | 3 | 3 | 100.0%
MusicBrainz release groups | TILE normalized | gpt-5.4-mini | 3 | 3 | 100.0%
npm dependency metadata | TILE normalized | gpt-5.4-mini | 3 | 3 | 100.0%
OpenStreetMap extract | TILE first-class relational | gpt-5.4-mini | 3 | 3 | 100.0%
Wikidata truthy triples | TILE first-class relational | gpt-5.4-mini | 3 | 2 | 66.7%
MusicBrainz release groups | TILE first-class relational | gpt-5.4-mini | 3 | 3 | 100.0%
npm dependency metadata | TILE first-class relational | gpt-5.4-mini | 3 | 1 | 33.3%
OpenStreetMap extract | TILE first-class embedded | gpt-5.4-mini | 3 | 3 | 100.0%
Wikidata truthy triples | TILE first-class embedded | gpt-5.4-mini | 3 | 2 | 66.7%
MusicBrainz release groups | TILE first-class embedded | gpt-5.4-mini | 3 | 3 | 100.0%
npm dependency metadata | TILE first-class embedded | gpt-5.4-mini | 3 | 3 | 100.0%

## Accuracy by perceived difficulty

| Difficulty | Variant | Model | Cases | Correct | Accuracy |
| ---: | --- | --- | ---: | ---: | ---: |
5 (very hard) | Compact JSON | gpt-5.4-mini | 9 | 9 | 100.0%
4 (harder) | Compact JSON | gpt-5.4-mini | 3 | 3 | 100.0%
5 (very hard) | Pretty JSON | gpt-5.4-mini | 9 | 7 | 77.8%
4 (harder) | Pretty JSON | gpt-5.4-mini | 3 | 3 | 100.0%
5 (very hard) | TILE path | gpt-5.4-mini | 9 | 9 | 100.0%
4 (harder) | TILE path | gpt-5.4-mini | 3 | 3 | 100.0%
5 (very hard) | TILE normalized | gpt-5.4-mini | 9 | 6 | 66.7%
4 (harder) | TILE normalized | gpt-5.4-mini | 3 | 3 | 100.0%
5 (very hard) | TILE first-class relational | gpt-5.4-mini | 9 | 7 | 77.8%
4 (harder) | TILE first-class relational | gpt-5.4-mini | 3 | 2 | 66.7%
5 (very hard) | TILE first-class embedded | gpt-5.4-mini | 9 | 8 | 88.9%
4 (harder) | TILE first-class embedded | gpt-5.4-mini | 3 | 3 | 100.0%
