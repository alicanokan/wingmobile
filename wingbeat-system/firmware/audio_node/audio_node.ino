// ============================================================================
//  Wing BEat — Audio Node Firmware (ESP8266 + I2S DAC)
//  Plays layered audio from LittleFS, controlled over MQTT.
//
//  Hardware:
//    ESP8266 NodeMCU / Wemos D1 mini
//    I2S DAC: PCM5102 module (recommended) or MAX98357A (built-in amp)
//
//  ESP8266 I2S pins (fixed by the chip):
//    BCK   → GPIO15 (D8)
//    LRCK  → GPIO2  (D4)
//    DIN   → GPIO3  (RX)   ← also serial RX, see notes
//
//  NOTE: GPIO3 is the serial RX line. After upload, the I2S audio uses RX.
//  You can keep Serial.print() for debug — TX is independent — but you cannot
//  receive serial input while audio plays. This is normal for ESP8266 + I2S.
//
//  Libraries:
//    - ESP8266WiFi, ESP8266mDNS              (esp8266 core)
//    - LittleFS                              (esp8266 core)
//    - PubSubClient                          >= 2.8
//    - ArduinoJson                           >= 6.21
//    - ESP8266Audio                          (Earle F. Philhower) >= 1.9.7
//
//  Uploading audio:
//    Put .mp3 files into firmware/audio_node/data/ then in Arduino IDE:
//      Tools → ESP8266 LittleFS Data Upload
//    Use short, low-bitrate mp3s (96 kbps mono is plenty for ambient layers).
// ============================================================================

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

#include "AudioFileSourceLittleFS.h"
#include "AudioGeneratorMP3.h"
#include "AudioOutputI2S.h"
#include "AudioFileSourceID3.h"

#include "config.h"

// ---------- Globals ---------------------------------------------------------
WiFiClient   espClient;
PubSubClient mqtt(espClient);

AudioGeneratorMP3*       gen     = nullptr;
AudioFileSourceLittleFS* file    = nullptr;
AudioFileSourceID3*      id3     = nullptr;
AudioOutputI2S*          out     = nullptr;

float    masterGain         = DEFAULT_MASTER_GAIN;
bool     bedRequested       = false;
String   currentLayerPath   = "";
String   queuedLayerPath    = "";   // a one-shot to start when current finishes
bool     queuedLoop         = false;

// MQTT topic helpers --------------------------------------------------------
String topicStatus()      { return String("wingbeat/node/") + NODE_ID + "/status"; }
String topicCmdAudio()    { return String("wingbeat/node/") + NODE_ID + "/cmd/audio"; }
String topicGlobalScene() { return String("wingbeat/global/scene"); }
String topicGlobalAll()   { return String("wingbeat/global/cmd/all"); }

// ---------- Audio helpers ---------------------------------------------------
void stopAudio() {
  if (gen && gen->isRunning()) gen->stop();
  if (id3) { delete id3;  id3  = nullptr; }
  if (file){ delete file; file = nullptr; }
  if (gen) { delete gen;  gen  = nullptr; }
  currentLayerPath = "";
}

bool startAudio(const String& path, bool loop) {
  stopAudio();
  if (!LittleFS.exists(path)) {
    Serial.printf("[audio] missing file: %s\n", path.c_str());
    return false;
  }
  file = new AudioFileSourceLittleFS(path.c_str());
  id3  = new AudioFileSourceID3(file);
  gen  = new AudioGeneratorMP3();
  out->SetGain(masterGain);
  if (!gen->begin(id3, out)) {
    Serial.println("[audio] generator failed to begin");
    stopAudio();
    return false;
  }
  currentLayerPath = path;
  // for loop, we re-queue at end of current
  queuedLayerPath = loop ? path : "";
  queuedLoop      = loop;
  Serial.printf("[audio] playing %s (loop=%d)\n", path.c_str(), (int)loop);
  return true;
}

const char* pathForLayer(const char* layer) {
  if      (!strcmp(layer, "bed"))    return LAYER_BED_PATH;
  else if (!strcmp(layer, "melody")) return LAYER_MELODY_PATH;
  else if (!strcmp(layer, "perc"))   return LAYER_PERC_PATH;
  else if (!strcmp(layer, "accent")) return LAYER_ACCENT_PATH;
  return nullptr;
}

// ---------- WiFi / MQTT -----------------------------------------------------
void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.hostname(NODE_ID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[wifi] connecting to %s ", WIFI_SSID);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(250); Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] ip=%s rssi=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }
}

void publishStatus(bool online) {
  StaticJsonDocument<160> d;
  d["online"] = online;
  d["role"]   = ROLE;
  d["fw"]     = FW_VERSION;
  d["rssi"]   = WiFi.RSSI();
  d["layer"]  = currentLayerPath.length() ? currentLayerPath.c_str() : "";
  d["gain"]   = masterGain;
  char buf[200];
  size_t n = serializeJson(d, buf);
  mqtt.publish(topicStatus().c_str(), (uint8_t*)buf, n, true);
}

void onMessage(char* topic, byte* payload, unsigned int len) {
  StaticJsonDocument<256> d;
  if (deserializeJson(d, payload, len)) return;
  String t = topic;

  if (t == topicCmdAudio()) {
    const char* layer = d["layer"] | "";
    bool play         = d["play"]  | true;
    bool loop         = d["loop"]  | (strcmp(layer, "bed") == 0); // bed loops by default
    if (d.containsKey("gain")) {
      float g = d["gain"];
      if (g < 0) g = 0; if (g > 1) g = 1;
      masterGain = g;
      if (out) out->SetGain(masterGain);
    }
    const char* path = pathForLayer(layer);
    if (path) {
      if (play) startAudio(path, loop);
      else      stopAudio();
    }
  } else if (t == topicGlobalAll()) {
    const char* action = d["action"] | "";
    if (!strcmp(action, "reset"))  ESP.restart();
    if (!strcmp(action, "silence")) stopAudio();
  } else if (t == topicGlobalScene()) {
    // optional: scene change could swap which sample bank to use.
    // For now we just log it; you can add scene-aware path lookups here.
    Serial.printf("[scene] %s\n", (const char*)(d["scene"] | ""));
  }
}

void connectMqtt() {
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);

  while (!mqtt.connected() && WiFi.status() == WL_CONNECTED) {
    Serial.print("[mqtt] connecting…");
    String willPayload = String("{\"online\":false,\"role\":\"") + ROLE + "\"}";
    bool ok = mqtt.connect(
        NODE_ID,
        strlen(MQTT_USER) ? MQTT_USER : nullptr,
        strlen(MQTT_PASS) ? MQTT_PASS : nullptr,
        topicStatus().c_str(), 1, true, willPayload.c_str()
    );
    if (ok) {
      Serial.println(" ok");
      mqtt.subscribe(topicCmdAudio().c_str(),    1);
      mqtt.subscribe(topicGlobalScene().c_str(), 1);
      mqtt.subscribe(topicGlobalAll().c_str(),   1);
      publishStatus(true);
    } else {
      Serial.printf(" rc=%d, retry in 2s\n", mqtt.state());
      delay(2000);
    }
  }
}

// ---------- Setup / loop ----------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.printf("\n=== Wing BEat audio node %s fw=%s ===\n", NODE_ID, FW_VERSION);

  if (!LittleFS.begin()) {
    Serial.println("[fs] LittleFS mount failed");
  } else {
    Serial.println("[fs] LittleFS mounted");
    Dir dir = LittleFS.openDir("/");
    while (dir.next()) {
      Serial.printf("  %s  (%u B)\n", dir.fileName().c_str(), dir.fileSize());
    }
  }

  out = new AudioOutputI2S();
  out->SetGain(masterGain);
  out->SetOutputModeMono(true);  // single-channel install — set false for stereo

  setupWifi();
  connectMqtt();

  // start ambient bed by default (so the install isn't silent on boot)
  if (LittleFS.exists(LAYER_BED_PATH)) {
    startAudio(LAYER_BED_PATH, true);
  }
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  // pump audio
  if (gen && gen->isRunning()) {
    if (!gen->loop()) {
      // current track finished — handle loop / queued
      String wasPath = currentLayerPath;
      stopAudio();
      if (queuedLayerPath.length()) {
        startAudio(queuedLayerPath, queuedLoop);
      }
    }
  }

  // periodic status
  static unsigned long lastStatusMs = 0;
  if (millis() - lastStatusMs > 15000) {
    lastStatusMs = millis();
    publishStatus(true);
  }
}
