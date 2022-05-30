const HX711 = require('pi-hx711');
const pigpio = require('pigpio');
const Gpio = pigpio.Gpio;

const globalData = {right: {value: 0, time: 0}, left: {value: 0, time: 0}, history: [], calibration: 100};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForState(dataPinRef, state, timeout) {
  // wait for the dataPin to go LOW
  dataPinRef.removeAllListeners('alert');

  let timeoutId = null;
  const delay = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      //console.log('timeout.');
      resolve(false);
    }, timeout);
  });

  let gotLow = new Promise((resolve, reject) => {
    dataPinRef.on('alert', (level, tick) => {
      //console.log(`${currentTime()}: Data Pin: ${level}`)
      if (level === state) {
        resolve(true);
      }
    });
  });

  // now see if we get low or timeout first
  return Promise.race([delay, gotLow]).then( (res) => {
    clearTimeout(timeoutId);
    dataPinRef.removeAllListeners('alert');
    return res;
  });
}

async function resetHX711(clockPin) {
  // reboot the HX711 (having the clock HIGH for over 60 us will do this)
  //console.log(`${currentTime()}: setting clock HIGH.`);
  clockPin.digitalWrite(1);
  console.log(`Setting clock pin HIGH.`);
  await sleep(2); //sleeping for 2 milliseconds is really like 2000 us
  clockPin.digitalWrite(0);
}

var globalStartTime = 0;

function currentTime() {
  return(Number(process.hrtime.bigint() - globalStartTime)/1e9);
}

function parseInt2complement(bitstring,bitcount)
{
  let value = parseInt(bitstring, 2);

  if ((value & (1<<(bitcount-1))) > 0) {
      value = value - (1<<(bitcount));
  }
  return value;
}

async function runLoadCell(sensorName, clockPinNumber, dataPinNumber) {

  globalStartTime = process.hrtime.bigint();
  //console.log(`Start time is: ${globalStartTime}`);

  const clockPin = new Gpio(clockPinNumber, {mode: Gpio.OUTPUT, pullUpDown: Gpio.PUD_DOWN, alert: true});
  const dataPin = new Gpio(dataPinNumber, {mode: Gpio.INPUT, pullUpDown: Gpio.PUD_DOWN, alert: true}); //important to set the pull down on this...

  await sleep(100);

  resetHX711(clockPin); //lets reset every time.

  let wentHigh = await waitForState(dataPin, 1, 2000);

  if (!wentHigh) {
    console.log(`Data didn't go HIGH.`);
  }

  for (let sample=0; sample<100000000; sample++) {
    let cycleStartTime = currentTime();
    await sleep(20);
    if (dataPin.digitalRead() === 1) {
      //console.log(`${currentTime()}: data is HIGH.`);
      //await sleep(5);
      let wentLow = await waitForState(dataPin, 0, 700);
     
      if (wentLow) {
        // now lets generate a 2us pulse followed by a 2us pause
        pigpio.waveClear();

        let waveform = [
          {gpioOn: clockPinNumber, gpioOff: 0,        usDelay: 2}, // turn clock HIGH, wait 2us
          {gpioOn: 0,        gpioOff: clockPinNumber, usDelay: 2} // turn clock LOW, wait 2us
        ]; 

        pigpio.waveAddGeneric(waveform);

        let waveId = pigpio.waveCreate();

        let total = 0;
        let totalString = '';

        for (let pulse=0; pulse<25; pulse++) {

          //console.log(`${currentTime()}: Sending pulse #${pulse}`);

          if (waveId >= 0) {
            pigpio.waveTxSend(waveId, pigpio.WAVE_MODE_ONE_SHOT);
          }

          while (pigpio.waveTxBusy()) {}

          //console.log(`${currentTime()}: Finished pulse #${pulse}`);

          //don't save the last one
          if (pulse < 24) {
            let dataValue = dataPin.digitalRead();

            total += 2**(24-pulse) * dataValue;
            totalString += dataValue?'1':'0';
          }

          //console.log(`${pulse}: ${dataVale}`);
        }
        
        //https://stackoverflow.com/questions/37022434/how-do-i-parse-a-twos-complement-string-to-a-number
        let scaleFactor = 100;
        let scaledTotal = parseInt2complement(totalString,24) / 0xFFFFFF * scaleFactor;

        //console.log(`Sample #${sample+1}: ${currentTime()} - ${totalString} (${scaledTotal})`);

        if (process?.stdout?.clearLine) {
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
          //process.stdout.write(`${sensorName} Sample #${(sample+1).toString().padStart(4,' ')}: ${currentTime().toFixed(3).padStart(6,' ')} = ${scaledTotal.toFixed(5).padStart(10,' ')})`);
        }
        else {
          //console.log(`${sensorName} Sample #${(sample+1).toString().padStart(4,' ')}: ${currentTime().toFixed(3).padStart(6,' ')} = ${scaledTotal.toFixed(5).padStart(10,' ')})`);
        }
        globalData[sensorName] = {value: scaledTotal, time: currentTime()};

        pigpio.waveDelete(waveId);

        //see what the clock pin is doing
        //let currentClockPin = clockPin.digitalRead();
        //console.log(`${currentTime()}: clock pin value: `,currentClockPin);
      }
      else {
        console.log(`${sensorName} ${currentTime()}: Error, timed out waiting for data to go LOW.`);
        resetHX711(clockPin);
        //process.exit(2);
      }
    }
    else {
      console.log(`${sensorName} ${currentTime()}: Error, expecting data to be HIGH`);
      //let wentHigh = await waitForState(dataPin, 1, 2000);
      //console.log(`${currentTime()}: went high: ${wentHigh}`);
      //process.exit(2);
      //await sleep(10);
      resetHX711(clockPin); //lets reset if its stuck
      let wentHigh = await waitForState(dataPin, 1, 30);
    }
    cycleEndTime = currentTime();

    //console.log(`cycle took: ${cycleEndTime - cycleStartTime}`);
  }

  await sleep(1000);
  process.exit(1);
}



  //let clockPinNumber = 2;  //attached to SCK
  //let dataPinNumber = 3; //attached to DT
runLoadCell("right", 12, 13);
runLoadCell("left", 16, 17);

const express = require('express')
const app = express();
app.use(express.json()); //enable json bodies
const port = 3000;

app.get('/', (req, res) => {
  res.send('Hello World!')
});

app.get('/api', (req, res) => {
  res.send(`${JSON.stringify(globalData)}`);
});

//when the app wants to save a sample
app.post('/save', (req, res) => {
  console.log(`Got a save command: type: ${req?.body?.type} weight: ${req?.body?.weight} time: ${req?.body?.time}`);
  
  if (req?.body?.type === 'cal' && req?.body?.weight > 5) {
    
    globalData.calibration *= (req?.body?.weight)/100;
    console.log(`Calibration: ${globalData.calibration}`)
  }
  else {
    globalData.history.push({type: req?.body?.type, weight: req?.body?.weight, time: req?.body?.time, date: Date.now()});
  }

  if (globalData.history.length > 1000) {
    globalData.history.shift();
  }

  res.send(`${JSON.stringify(globalData)}`);
});

app.use(express.static('ui'));

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})