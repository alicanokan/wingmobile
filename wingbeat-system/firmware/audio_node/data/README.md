# Audio node sample bank

Drop your sound layers here as `.mp3` files (96 kbps mono is plenty):

- `bed.mp3`     — ambient drone, plays continuously, loops
- `melody.mp3`  — one-shot melodic phrase, triggered on wind crescendo
- `perc.mp3`    — one-shot percussive accent
- `accent.mp3`  — one-shot bell / chime

Then in Arduino IDE:

`Tools → ESP8266 LittleFS Data Upload`

(Install the plugin first: https://github.com/earlephilhower/arduino-esp8266littlefs-plugin)

Total LittleFS space on a 4 MB ESP8266 with the recommended partition is
~1 MB. Keep the four files combined under ~900 KB.
