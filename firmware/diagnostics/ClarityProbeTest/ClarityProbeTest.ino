#include <Arduino.h>

// Standalone bench test. Keep module supply at the previously tested 3V3.
constexpr uint8_t SENSOR_PIN = 35;
constexpr int SAMPLES = 31;
float cleanMv = -1;

void sortSamples(uint16_t *values) {
  for (int i = 1; i < SAMPLES; ++i) {
    uint16_t value = values[i];
    int j = i - 1;
    while (j >= 0 && values[j] > value) {
      values[j + 1] = values[j];
      --j;
    }
    values[j + 1] = value;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(SENSOR_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(SENSOR_PIN, ADC_11db);
  Serial.println("\nTHU TIN HIEU DO TRONG - GPIO35");
  Serial.println("C: ghi moc nuoc sach tam | R: xoa moc tam");
  Serial.println("Chi doc GPIO35; khong suy ra OUT, NTU hay do an toan cua nuoc.");
}

void loop() {
  uint16_t raw[SAMPLES], mv[SAMPLES];
  for (int i = 0; i < SAMPLES; ++i) {
    raw[i] = analogRead(SENSOR_PIN);
    mv[i] = analogReadMilliVolts(SENSOR_PIN);
    delay(3);
  }
  sortSamples(raw);
  sortSamples(mv);
  const float currentMv = mv[SAMPLES / 2];
  const uint16_t currentRaw = raw[SAMPLES / 2];
  // Bound command processing so serial input cannot stop acquisition.
  for (int i = 0; i < 32 && Serial.available(); ++i) {
    const char command = Serial.read();
    if (command == 'C' || command == 'c') {
      if (currentRaw <= 5 || currentRaw >= 4090 || currentMv < 150 || currentMv > 3000) {
        Serial.println("CHUA GHI MOC: tin hieu gan bien ADC/ngoai dai dang su dung.");
      } else {
        cleanMv = currentMv;
        Serial.printf("DA GHI MOC THU: %.0f mV. Chi luu RAM, khong doi moc dashboard.\n", cleanMv);
      }
    }
    if (command == 'R' || command == 'r') {
      cleanMv = -1;
      Serial.println("DA XOA MOC THU.");
    }
  }
  Serial.printf("GPIO35: %.0f mV | ADC: %u | Dao dong trong lan doc: %u mV",
                currentMv, static_cast<unsigned>(currentRaw), static_cast<unsigned>(mv[SAMPLES-1] - mv[0]));
  if (cleanMv > 0) Serial.printf(" | Moc sach: %.0f mV | Chenh: %+.0f mV", cleanMv, currentMv - cleanMv);
  if (currentRaw <= 5) Serial.print(" | ADC GAN 0: kiem tra duong tin hieu");
  else if (currentRaw >= 4090) Serial.print(" | ADC CHAM TRAN: khong suy ra dien ap that tu so nay");
  else if (currentMv < 150 || currentMv > 3000) Serial.print(" | NGOAI DAI firmware dashboard chap nhan (150-3000 mV)");
  Serial.println();
  delay(1900); // About one output line every 2 seconds, including acquisition.
}
