// ============================================================================
//  Wing BEat — Feather Node Firmware (ESP8266)
//  Role: sensor + WS2812 LED feather
//  Author: Alican Okan / generated scaffold
//
//  What it does:
//    • Reads breath/wind (mic or anemometer) on A0
//    • Reads MPU6050 accelerometer for feather sway / shake
//    • Reads PIR for participant presence
//    • Publishes those over MQTT
//    • Subscribes to LED commands and renders WS2812 patterns
//    • Subscribes to global scene changes
//
//  Libraries (install via Arduino Library Manager / PlatformIO):
//    - ESP8266WiFi              (built in with esp8266 core)
//    - PubSubClient             (Nick O'Leary)         >= 2.8
//    - ArduinoJson              (Benoit Blanchon)       >= 6.21
//    - Adafruit NeoPixel        (Adafruit)              >= 1.12
//    - MPU6050_light            (rfetick)               >= 1.1
//    - Wire                     (built in)
//
//  Board: NodeMCU 1.0 (ESP-12E) or Wemos D1 mini, 80 MHz CPU.
// ============================================================================

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>
#include <Wire.h>
#include <MPU6050_light.h>

#include "config.h"

// ---------- Globals ---------------------------------------------------------
WiFiClient   espClient;
PubSubClient mqtt(espClient);
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

#if USE_MPU6050
MPU6050 imu(Wire);
#endif

struct LedState {
  uint8_t r = 20, g = 30, b = 40;
  uint8_t intensity = 80;     // 0..255
  enum Mode { OFF, SOLID, PULSE, SHIMMER, WIND, RAINBOW } mode = PULSE;
} ledState;

float windEma   = 0.0f;
float motionEma = 0.0f;
unsigned long lastWindPubMs   = 0;
unsigned long lastMotionPubMs = 0;
unsigned long lastStatusMs    = 0;
unsigned long lastPirHighMs   = 0;
bool          presentLast     = false;

// MQTT topic helpers --------------------------------------------------------
String topicStatus()    { return String("wingbeat/node/") + NODE_ID + "/status"; }
String topicWind()      { return String("wingbeat/node/") + NODE_ID + "/sensor/wind"; }
String topicMotion()    { return String("wingbeat/node/") + NODE_ID + "/sensor/motion"; }
String topicPresence()  { return String("wingbeat/node/") + NODE_ID + "/sensor/presence"; }
String topicCmdLed()    { return String("wingbeat/node/") + NODE_ID + "/cmd/led"; }
String topicGlobalScene() { return String("wingbeat/global/scene"); }
String topicGlobalAll()   { return String("wingbeat/global/cmd/all"); }

// ---------- WiFi ------------------------------------------------------------
void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.hostname(NODE_ID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[wifi] connecting to %s ", WIFI_SSID);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] ip=%s rssi=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("[wifi] failed — running offline, will retry");
  }
}

// ---------- MQTT ------------------------------------------------------------
void publishStatus(bool online) {
  StaticJsonDocument<160> d;
  d["online"] = online;
  d["role"]   = ROLE;
  d["fw"]     = FW_VERSION;
  d["rssi"]   = WiFi.RSSI();
  d["ip"]     = WiFi.localIP().toString();
  char buf[160];
  size_t n = serializeJson(d, buf);
  mqtt.publish(topicStatus().c_str(), (uint8_t*)buf, n, /*retain=*/true);
}

void onMessage(char* topic, byte* payload, unsigned int len) {
  StaticJsonDocument<256> d;
  DeserializationError err = deserializeJson(d, payload, len);
  if (err) { Serial.printf("[mqtt] bad json on %s: %s\n", topic, err.c_str()); return; }

  String t = topic;
  if (t == topicCmdLed()) {
    if (d.containsKey("r")) ledState.r = d["r"];
    if (d.containsKey("g")) ledState.g = d["g"];
    if (d.containsKey("b")) ledState.b = d["b"];
    if (d.containsKey("intensity")) {
      float v = d["intensity"]; if (v < 0) v = 0; if (v > 1) v = 1;
      ledState.intensity = (uint8_t)(v * 255.0f);
    }
    if (d.containsKey("mode")) {
      const char* m = d["mode"];
      if      (!strcmp(m, "off"))     ledState.mode = LedState::OFF;
      else if (!strcmp(m, "solid"))   ledState.mode = LedState::SOLID;
      else if (!strcmp(m, "pulse"))   ledState.mode = LedState::PULSE;
      else if (!strcmp(m, "shimmer")) ledState.mode = LedState::SHIMMER;
      else if (!strcmp(m, "wind"))    ledState.mode = LedState::WIND;
      else if (!strcmp(m, "rainbow")) ledState.mode = LedState::RAINBOW;
    }
  } else if (t == topicGlobalScene()) {
    // Optional: react to scene change (e.g. tint default LED color).
    const char* scene = d["scene"] | "";
    Serial.printf("[scene] %s\n", scene);
  } else if (t == topicGlobalAll()) {
    const char* action = d["action"] | "";
    if (!strcmp(action, "rainbow")) ledState.mode = LedState::RAINBOW;
    else if (!strcmp(action, "reset")) ESP.restart();
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
      mqtt.subscribe(topicCmdLed().c_str(),       1);
      mqtt.subscribe(topicGlobalScene().c_str(),  1);
      mqtt.subscribe(topicGlobalAll().c_str(),    1);
      publishStatus(true);
    } else {
      Serial.printf(" rc=%d, retry in 2s\n", mqtt.state());
      delay(2000);
    }
  }
}

// ---------- Sensors ---------------------------------------------------------
float readWindNormalized() {
  // ESP8266 A0 reads 0..1023 over 0..1V (assuming the typical NodeMCU divider).
  int raw = analogRead(A0);

#if defined(WIND_SOURCE_MIC)
  // Electret with DC-blocking cap — RMS via running peak-to-peak window.
  static int p2pPeak = 0;
  static int p2pTrough = 1023;
  static unsigned long winStart = 0;
  if (millis() - winStart > 50) {  // 50 ms window
    int p2p = p2pPeak - p2pTrough;
    p2pPeak = raw; p2pTrough = raw; winStart = millis();
    float v = (float)p2p / 600.0f; // empirical scaling, tune for your mic
    if (v < 0) v = 0; if (v > 1) v = 1;
    return v;
  }
  if (raw > p2pPeak)   p2pPeak = raw;
  if (raw < p2pTrough) p2pTrough = raw;
  return -1.0f; // signal "no new sample yet"
#else
  // Anemometer: linear voltage proportional to wind speed.
  float v = (float)raw / 1023.0f;
  return v;
#endif
}

#if USE_MPU6050
float readMotionMagnitude() {
  imu.update();
  float ax = imu.getAccX();
  float ay = imu.getAccY();
  float az = imu.getAccZ() - 1.0f; // remove gravity (rough)
  return sqrtf(ax*ax + ay*ay + az*az);
}
#endif

bool readPresence() {
  bool pir = digitalRead(PIR_PIN) == HIGH;
  if (pir) lastPirHighMs = millis();
  return (millis() - lastPirHighMs) < PIR_PRESENCE_HOLD_MS;
}

// ---------- LED rendering ---------------------------------------------------
void renderLeds(float windNow, float motionNow) {
  uint16_t now = millis() & 0xFFFF;
  uint8_t  scaledIntensity = ledState.intensity;
  uint8_t  baseR = ledState.r;
  uint8_t  baseG = ledState.g;
  uint8_t  baseB = ledState.b;

  switch (ledState.mode) {
    case LedState::OFF:
      strip.clear();
      break;

    case LedState::SOLID:
      for (uint16_t i = 0; i < LED_COUNT; i++) {
        strip.setPixelColor(i, strip.Color(
            (baseR * scaledIntensity) >> 8,
            (baseG * scaledIntensity) >> 8,
            (baseB * scaledIntensity) >> 8));
      }
      break;

    case LedState::PULSE: {
      float phase = (sinf(now * 0.0025f) + 1.0f) * 0.5f;
      uint8_t lvl = (uint8_t)(phase * scaledIntensity);
      for (uint16_t i = 0; i < LED_COUNT; i++) {
        strip.setPixelColor(i, strip.Color(
            (baseR * lvl) >> 8,
            (baseG * lvl) >> 8,
            (baseB * lvl) >> 8));
      }
    } break;

    case LedState::SHIMMER: {
      for (uint16_t i = 0; i < LED_COUNT; i++) {
        // independent twinkle per pixel
        float phase = sinf((now + i * 137) * 0.004f);
        phase = (phase + 1.0f) * 0.5f;
        uint8_t lvl = (uint8_t)(phase * scaledIntensity);
        strip.setPixelColor(i, strip.Color(
            (baseR * lvl) >> 8,
            (baseG * lvl) >> 8,
            (baseB * lvl) >> 8));
      }
    } break;

    case LedState::WIND: {
      // wind drives a wave traveling along the strip
      float w = windNow;            // 0..1
      float speed = 0.003f + w * 0.02f;
      for (uint16_t i = 0; i < LED_COUNT; i++) {
        float phase = sinf(i * 0.4f - now * speed) * 0.5f + 0.5f;
        float lvl   = phase * (0.3f + 0.7f * w);
        uint8_t v   = (uint8_t)(lvl * scaledIntensity);
        strip.setPixelColor(i, strip.Color(
            (baseR * v) >> 8,
            (baseG * v) >> 8,
            (baseB * v) >> 8));
      }
    } break;

    case LedState::RAINBOW: {
      for (uint16_t i = 0; i < LED_COUNT; i++) {
        uint16_t hue = (i * 65536L / LED_COUNT) + (now * 8);
        strip.setPixelColor(i,
          strip.gamma32(strip.ColorHSV(hue, 255, scaledIntensity)));
      }
    } break;
  }

  // Tiny motion kick: brief white flash on a random pixel proportional to motion.
  if (motionNow > 0.4f) {
    uint16_t i = random(LED_COUNT);
    uint8_t v = (uint8_t)(min(1.0f, motionNow) * 255);
    strip.setPixelColor(i, strip.Color(v, v, v));
  }

  strip.show();
}

// ---------- Setup / loop ----------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.printf("\n=== Wing BEat feather node %s fw=%s ===\n", NODE_ID, FW_VERSION);

  pinMode(PIR_PIN, INPUT);

  strip.begin();
  strip.setBrightness(LED_BRIGHTNESS_DEFAULT);
  strip.clear(); strip.show();

#if USE_MPU6050
  Wire.begin();   // SDA=D2/GPIO4, SCL=D1/GPIO5 on NodeMCU
  byte status = imu.begin();
  Serial.printf("[imu] mpu6050 status=%d\n", status);
  if (status == 0) {
    delay(800);
    imu.calcOffsets(true, true); // calibrate accel + gyro
    Serial.println("[imu] calibrated");
  }
#endif

  setupWifi();
  connectMqtt();
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  // ---- Wind / breath ----
  float w = readWindNormalized();
  if (w >= 0.0f) {
    windEma = WIND_EMA_ALPHA * w + (1.0f - WIND_EMA_ALPHA) * windEma;
    if (windEma < WIND_NOISE_FLOOR) windEma = 0.0f;

    unsigned long minDt = 1000UL / WIND_PUBLISH_HZ;
    if (millis() - lastWindPubMs >= minDt) {
      lastWindPubMs = millis();
      char buf[80];
      int n = snprintf(buf, sizeof(buf),
          "{\"v\":%.3f,\"raw\":%d,\"ts\":%lu}", windEma, analogRead(A0), millis());
      mqtt.publish(topicWind().c_str(), (uint8_t*)buf, n, false);
    }
  }

#if USE_MPU6050
  // ---- Motion ----
  float m = readMotionMagnitude();
  motionEma = MOTION_EMA_ALPHA * m + (1.0f - MOTION_EMA_ALPHA) * motionEma;
  if (motionEma < MOTION_NOISE_FLOOR) motionEma = 0.0f;

  if (millis() - lastMotionPubMs >= (1000UL / MOTION_PUBLISH_HZ)) {
    lastMotionPubMs = millis();
    StaticJsonDocument<160> d;
    d["ax"]  = imu.getAccX();
    d["ay"]  = imu.getAccY();
    d["az"]  = imu.getAccZ();
    d["mag"] = motionEma;
    d["ts"]  = millis();
    char buf[160];
    size_t n = serializeJson(d, buf);
    mqtt.publish(topicMotion().c_str(), (uint8_t*)buf, n, false);
  }
#else
  float motionEmaForLed = 0.0f;
#endif

  // ---- Presence ----
  bool present = readPresence();
  if (present != presentLast) {
    presentLast = present;
    char buf[80];
    int n = snprintf(buf, sizeof(buf),
        "{\"present\":%s,\"ts\":%lu}",
        present ? "true" : "false", millis());
    mqtt.publish(topicPresence().c_str(), (uint8_t*)buf, n, /*retain=*/true);
  }

  // ---- Heartbeat ----
  if (millis() - lastStatusMs > (unsigned long)STATUS_PUBLISH_S * 1000UL) {
    lastStatusMs = millis();
    publishStatus(true);
  }

  // ---- Render LEDs at ~60 fps ----
  static unsigned long lastFrame = 0;
  if (millis() - lastFrame >= 16) {
    lastFrame = millis();
#if USE_MPU6050
    renderLeds(windEma, motionEma);
#else
    renderLeds(windEma, 0.0f);
#endif
  }
}
