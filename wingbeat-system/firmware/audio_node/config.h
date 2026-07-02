// ============================================================================
//  Wing BEat — Audio Node Config
//  ESP8266 + I2S DAC (PCM5102 or MAX98357A) playing layered sound files
//  from on-board flash (LittleFS). MQTT-controlled.
// ============================================================================
#pragma once

#define NODE_ID         "audio_01"
#define FW_VERSION      "0.1.0"
#define ROLE            "audio"

#define WIFI_SSID       "WingBeat"
#define WIFI_PASS       "feathersinthewind"

#define MQTT_HOST       "192.168.4.1"
#define MQTT_PORT       1883
#define MQTT_USER       ""
#define MQTT_PASS       ""

// Layer file paths in LittleFS (upload via "Tools → ESP8266 LittleFS Data Upload"
// after putting your audio in firmware/audio_node/data/)
#define LAYER_BED_PATH     "/bed.mp3"
#define LAYER_MELODY_PATH  "/melody.mp3"
#define LAYER_PERC_PATH    "/perc.mp3"
#define LAYER_ACCENT_PATH  "/accent.mp3"

// Default mix
#define DEFAULT_MASTER_GAIN  0.85f
#define BED_LOOP             1   // loop the bed forever; melody/perc/accent are one-shot
