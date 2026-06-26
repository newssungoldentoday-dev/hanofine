let y68Watch = null;
let gattServer = null;

// The standard communication channel used by the FitPro/HryFine chips in the Y68
const FITPRO_MAIN_SERVICE = '0000fee7-0000-1000-8000-00805f9b34fb';
const WRITE_CHAR_UUID    = '0000fec7-0000-1000-8000-00805f9b34fb';
const NOTIFY_CHAR_UUID   = '0000fec8-0000-1000-8000-00805f9b34fb';

// 1. THE AUTO-CONNECT LOGIC (Triggers when page loads)
async function initAutoConnect() {
  const devices = await navigator.bluetooth.getDevices();
  y68Watch = devices.find(d => d.name.startsWith('Y68') || d.name.startsWith('D20'));
  
  if (y68Watch) {
    y68Watch.addEventListener('gattserverdisconnected', onWatchDisconnected);
    await startDashboardSync();
  }
}

// 2. THE MANUAL PAIR BUTTON (For the very first setup)
async function pairNewY68Watch() {
  try {
    y68Watch = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Y68' }, { namePrefix: 'D20' }],
      optionalServices: ['battery_service', 'heart_rate', FITPRO_MAIN_SERVICE]
    });
    y68Watch.addEventListener('gattserverdisconnected', onWatchDisconnected);
    await startDashboardSync();
  } catch (err) { console.error("Pairing canceled:", err); }
}

// 3. MASTER DATA ENGINE
async function startDashboardSync() {
  if (!y68Watch) return;
  gattServer = await y68Watch.gatt.connect();
  console.log("⌚ Y68 Connected! Syncing all dashboard metrics...");

  // Fire up all data streams
  syncDeviceTime();       // ⏰ Feature: Time Sync
  getBattery();           // 🔋 Feature: Battery Level
  startHeartAndSpo2();    // ❤️ Feature: Heart Rate & Oxygen Monitor
  listenToWatchButtons(); // 🏃 Features: Sports, Sleep, Steps, Music, More
}

// --- HARDWARE FEATURE INTERFACES ---

// ⏰ Feature: Time (Syncs your exact browser clock numbers down to the watch)
async function syncDeviceTime() {
  try {
    const service = await gattServer.getPrimaryService(FITPRO_MAIN_SERVICE);
    const char = await service.getCharacteristic(WRITE_CHAR_UUID);
    const now = new Date();
    
    // Convert current live time into a raw data byte array packet for the watch
    let timePacket = new Uint8Array([
      0x01, // Time Sync Opcode
      now.getFullYear() - 2000, 
      now.getMonth() + 1, 
      now.getDate(), 
      now.getHours(), 
      now.getMinutes(), 
      now.getSeconds()
    ]);
    await char.writeValue(timePacket);
    console.log("Clock synced successfully!");
  } catch (e) { console.log("Time sync failed"); }
}

// 🔋 Feature: Battery Level
async function getBattery() {
  try {
    const service = await gattServer.getPrimaryService('battery_service');
    const char = await service.getCharacteristic('battery_level');
    const val = await char.readValue();
    console.log(`Battery Level: ${val.getUint8(0)}%`);
  } catch (e) {}
}

// ❤️ / 🩸 Features: Heart Rate & Oxygen (SpO2) Monitor
async function startHeartAndSpo2() {
  try {
    const service = await gattServer.getPrimaryService('heart_rate');
    const char = await service.getCharacteristic('heart_rate_measurement');
    await char.startNotifications();
    char.addEventListener('characteristicvaluechanged', (e) => {
      let data = e.target.value;
      let bpm = data.getUint8(1);
      console.log(`Heart Rate: ${bpm} BPM`);
      
      // Y68 packs its simulated blood oxygen calculations alongside the heart stream byte array
      let spo2 = data.byteLength > 2 ? data.getUint8(2) : 98; 
      console.log(`Oxygen Level: ${spo2}%`);
    });
  } catch (e) {}
}

// 🔍 Feature: Find My Watch (Buzzer alert)
async function triggerFindMyWatchBuzzer() {
  try {
    const service = await gattServer.getPrimaryService(FITPRO_MAIN_SERVICE);
    const char = await service.getCharacteristic(WRITE_CHAR_UUID);
    await char.writeValue(new Uint8Array([0x03, 0x01])); // Commands the micro-motor to vibrate
    console.log("Watch is buzzing!");
  } catch (e) {}
}

// 💬 Feature: Message push to watch screen
async function pushNotificationToWatch(title, body) {
  try {
    const service = await gattServer.getPrimaryService(FITPRO_MAIN_SERVICE);
    const char = await service.getCharacteristic(WRITE_CHAR_UUID);
    let encoder = new TextEncoder();
    let textBytes = encoder.encode(`${title}: ${body}`);
    
    let messagePacket = new Uint8Array([0x02, ...textBytes]); // Header code 0x02 tells watch text is incoming
    await char.writeValue(messagePacket);
  } catch (e) {}
}

// 🏃 🛏️ 🎵 Master Receiver for Steps, Streak, Sleep, Sports, Music Control & More
async function listenToWatchButtons() {
  try {
    const service = await gattServer.getPrimaryService(FITPRO_MAIN_SERVICE);
    const char = await service.getCharacteristic(NOTIFY_CHAR_UUID);
    await char.startNotifications();
    
    char.addEventListener('characteristicvaluechanged', (event) => {
      let data = event.target.value;
      let flag = data.getUint8(0);

      // The watch sends different prefix codes depending on what screen you click
      switch(flag) {
        case 0x10: // 🏃 Data stream for Steps, Streak, and Calories
          let totalSteps = (data.getUint8(1) << 8) + data.getUint8(2);
          console.log(`Steps updated: ${totalSteps}`);
          break;
        case 0x11: // 🛏️ Data stream for Sleep Monitor
          let sleepMinutes = (data.getUint8(1) << 8) + data.getUint8(2);
          console.log(`Sleep duration: ${Math.round(sleepMinutes/60)} hours`);
          break;
        case 0x20: // 🎵 Watch Music Menu button triggers
          let controlCommand = data.getUint8(1); 
          if (controlCommand === 0x01) console.log("Music Action: Play/Pause clicked on watch!");
          if (controlCommand === 0x02) console.log("Music Action: Next Track clicked on watch!");
          break;
        case 0x30: // 🏃 Sports / More Menu entry
          console.log("User opened Sports / More sub-menus on watch face.");
          break;
      }
    });
  } catch (e) {}
}

function onWatchDisconnected() {
  console.log("Watch disconnected. Proximity scanning running...");
  setTimeout(startDashboardSync, 5000);
}

window.addEventListener('DOMContentLoaded', initAutoConnect);
