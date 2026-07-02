// ============================================================================
//  Wing BEat — Feather Node Config
//  Per-node settings. Copy this folder, rename to feather_02 / feather_03 / …
//  and change NODE_ID + any wiring that differs.
// ============================================================================
#pragma once

// ----- Identity -------------------------------------------------------------
#define NODE_ID         "feather_01"      // unique per node
#define FW_VERSION      "0.1.0"
#define ROLE            "feather"

// ----- WiFi -----------------------------------------------------------------
#define WIFI_SSID       "WingBeat"
#define WIFI_PASS       "feathersinthewind"

// ----- MQTT broker ----------------------------------------------------------
#define MQTT_HOST       "192.168.4.1"     // Mac mini IP on the install LAN
#define MQTT_PORT       1883
#define MQTT_USER       ""                // leave empty for anonymous
#define MQTT_PASS       ""

// ----- Sensors --------------------------------------------------------------
// ESP8266 has ONE analog pin (A0) shared between mic & anemometer.
// Pick which one this board carries and comment the other.
#define WIND_SOURCE_MIC          1   // electret breakout into A0 via 0-1V divider
// #define WIND_SOURCE_ANEMOMETER 1  // adafruit anemo / hot-wire into A0

// MPU6050 IMU on I2C (D1=GPIO5 SCL, D2=GPIO4 SDA on NodeMCU).
#define USE_MPU6050              1
#define MPU6050_ADDR             0x68

// PIR motion presence on D5 (GPIO14). HIGH when someone is near.
#define PIR_PIN                  14
#define PIR_PRESENCE_HOLD_MS     2500   // keep "present" true for this long after PIR drops

// (optional) VL53L0X ToF on the same I2C bus, gives cm distance.
// #define USE_VL53L0X            1

// ----- LEDs (WS2812 / NeoPixel) ---------------------------------------------
#define LED_PIN                  15      // D8 / GPIO15  (must be a non-boot-strap pin if possible)
#define LED_COUNT                32      // pixels per feather
#define LED_BRIGHTNESS_DEFAULT   140     // 0..255

// ----- Behavior tuning ------------------------------------------------------
#define WIND_PUBLISH_HZ          20      // publish rate when wind is changing
#define MOTION_PUBLISH_HZ        10
#define STATUS_PUBLISH_S         15      // periodic heartbeat
#define WIND_NOISE_FLOOR         0.04f   // anything below treated as 0
#define MOTION_NOISE_FLOOR       0.08f

// Smoothing — exponential moving average alphas (0..1, higher = snappier).
#define WIND_EMA_ALPHA           0.30f
#define MOTION_EMA_ALPHA         0.40f
