function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const globalData = [];
const maxSamples = 500;

//moving average figure
function drawTrend(x, y) {
  
  var plots = [];

  var plot1 = {
      x: x,
      y: y,
      name: "data",
      type: 'scatter',
      mode: 'lines',
      line: {
          width: 3,
          //color: colorList[t]
      }
  }
  plots.push(plot1);

  var layout = {
      //title: 'Weight',
      showlegend: false,
      margin: {
        l: 20,
        r: 20,
        b: 20,
        t: 20,
        pad: 4
      }
  };
      
  Plotly.newPlot('trendOuter', plots, layout, {scrollZoom: false});	
}

function hangTimeCalc(x, y) {

  const minimumWeight = 10; //there must be at least 10% of body weight

  let minSamples = 8;

  if (y.length < minSamples) {
    return({hangTime: 0, hangWeight: 0});
  }

  //now go back through the samples until we find 5 consectutive samples where the weight is < the minimum

  let startSample = 0;
  let consectutiveOffCount = 0;
  let consectutiveOnCount = 0;

  for (let i=y.length-1; i>=0; i--) {
    if (y[i] < minimumWeight) {
      if (consectutiveOnCount > minSamples) {
        consectutiveOffCount++;
        if (consectutiveOffCount >= minSamples) {
          break;
        }
      }
    }
    else {
      consectutiveOnCount++;
      consectutiveOffCount = 0;
      startSample = i;
    }
  }

  let xHang = x.slice(startSample);
  let yHang = y.slice(startSample);

  let maxWeight = Math.max(...yHang);

  //now remove samples that are < 70% of the maxWeight

  //let removeLow = yHang.filter(x => x > 0.7*maxWeight).sort();

  //now find the median
  //let median = removeLow[Math.floor(removeLow.length/2)];
 
  //lets also get the time averaged weight
  let totalWeightSeconds = 0;
  let hangSeconds = 0;
  for (let i=0; i<yHang.length-1; i++) {
    let sampleStart = xHang[i]/1000;
    let sampleEnd = xHang[i+1]/1000;
    let sampleValue = (yHang[i] + yHang[i+1])/2;

    if (yHang[i] > 0.7 * maxWeight && yHang[i+1] >= 0.7) {
      totalWeightSeconds += (sampleEnd - sampleStart) * sampleValue;
      hangSeconds += (sampleEnd - sampleStart);
    }
  }

  let hangTime = hangSeconds;
  let hangWeight = (hangTime>0)?totalWeightSeconds/hangSeconds:0
  if (!Number.isFinite(hangWeight)) {hangWeight=0;}
  
  return({hangTime: hangTime, hangWeight: hangWeight});
}

var globalCommand = false;

function saveCommand(saveType) {
  globalCommand = saveType;
}

async function main() {
  let saveList = [];

  //calculate the zero in real time
  let zeroOffset = 0;
  let maxSmallValue = 0.7;

  let valueHistoryLeft = [];
  let valueHistoryRight = [];

  do {

    let response = await fetch('./api');
    let result = await response.json();

    let calibration = result.calibration??100;
    console.log(`Calibration: ${calibration}`);

    saveList = result.history??[];
    //console.log(result);

    //let scaleFactor0 = 30;
    //let scaleFactor = -180;
    let offset = 0.011;

    let rawLeft = result.right?.value ?? 0;
    let rawRight = result.left?.value ?? 0

    valueHistoryLeft.push(rawLeft);
    valueHistoryRight.push(rawRight);

    //if (valueHistoryLeft.length > 10) {
    //  debugger;
    //}

    let smallValues = valueHistoryLeft.filter(x => x !== 0 && Math.abs(x) < maxSmallValue);
    let leftZero = smallValues[Math.floor(smallValues.length/2)]??0;
    smallValues = valueHistoryRight.filter(x => x !== 0 && Math.abs(x) < maxSmallValue);
    let rightZero = smallValues[Math.floor(smallValues.length/2)]??0;

    let zeroedLeft = Math.abs(rawLeft - leftZero);
    let zeroedRight = Math.abs(rawRight - rightZero);

    // let weightFraction = ((result?.right?.value ?? 0) + (result?.left?.value ?? 0)) / scaleFactor0;
    // //let weightFractionLeft = (result?.right?.value ?? 0) - offset

    // let total = Math.min(Math.abs(weightFraction + offset), 1);
    // let height = total * 60;

    let scaleFactor = 100/26.8 * 100/calibration; //do in percent
    let value = (zeroedLeft + zeroedRight) * scaleFactor;

    let height = Math.max((value/200) * 60,5);

    globalData.push({value: value, time: Date.now()});

    if (globalData.length > maxSamples) {
      globalData.shift();
    }

    let drawX = globalData.map((x) => x.time);
    let drawY = globalData.map((x) => x.value);
    drawTrend(drawX, drawY);

    let hangTimeResult = hangTimeCalc(drawX, drawY);
    let hangTime = hangTimeResult.hangTime;
    let hangWeight = hangTimeResult.hangWeight;

    let historyHtml = saveList.filter(x => x.time > 0.5).slice(-10).map(x => `${(new Date(x.date)).toLocaleTimeString()} ${x.type}:${x.weight.toFixed(1)}% ${x.time.toFixed(1)}s`).join('<br/>');

    let htmlResult = `
      <div style="position: fixed; top: 0px; left:0px; width:95%; height:80%; overflow: hidden">
        <div style="display: table; text-align: center; position: absolute; top: 20vh; left: 40vw; width: 20vw; height: ${height}vh; background-color: blue; color: white; font-weight: bold; font-size: 2em">
          <div style="display: table-cell; text-align: center;  color: white; font-weight: bold; font-size: 2em">
            ${hangWeight>0?hangWeight.toFixed(1):Math.abs(value).toFixed(4)}<br/>${hangTime.toFixed(1)}
          </div>
        </div>
        <button onmouseup="saveCommand('cal')" style="position: fixed; top: 0px; left: 0vw; width: 18vw; height: 10vh;" value="cal">Cal</button>
        <button onmouseup="saveCommand('L')" style="position: fixed; top: 0px; left: 20vw; width: 18vw; height: 10vh;" value="save-left">Save Left</button>
        <button onmouseup="saveCommand('B')" style="position: fixed; top: 0px; left: 40vw; width: 18vw; height: 10vh;" value="save-both">Save Both</button>
        <button onmouseup="saveCommand('R')" style="position: fixed; top: 0px; left: 60vw; width: 18vw; height: 10vh;" value="save-right">Save Right</button>
        <button onmouseup="window.location.href=window.location.href" style="position: fixed; top: 0px; left: 80vw; width: 18vw; height: 10vh;" value="discard">Discard</button>
        <div style="position: fixed; top: 25vh; left: 0px; width: 50vw; height: 20vh; font-weight: bold; font-size: 2em">
          ${historyHtml}
        </div>
      </div>
    `;
    document.getElementById("content").innerHTML = htmlResult;

    //see if a button click command happened
    if (globalCommand) {

      console.log(`Got command: ${globalCommand}`);

      //post some json to the page
      const rawResponse = await fetch('./save', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ type: globalCommand, weight: hangWeight, time: hangTime })
        }
      );
      const resultContent = await rawResponse.json();
      console.log('response:', resultContent);

      //saveList.push({type: globalCommand, weight: hangWeight, time: hangTime});
      globalCommand = false;
      window.location.reload();
    }

    await sleep(50);
  } while (true);
} 