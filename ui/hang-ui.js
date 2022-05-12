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
      title: 'Weight',
      showlegend: false
  };
      
  Plotly.newPlot('trendOuter', plots, layout, {scrollZoom: false});	
}

function hangTimeCalc(x, y) {
  const minimumWeight = 3; //there must be at least 5 lb.
  let maxWeight = Math.max(...y, minimumWeight);
  
  let endTime = 0;//x[x.length-1];
  let startTime = endTime;

  console.log('maxWeight: ', maxWeight);

  //go backwards through the array as long as weight is more than 80% of the max.
  let startSample = 0;
  let endSample = 0;
  for (let i=y.length-1; i>=0; i--) {
    if (y[i] > 0.9 * maxWeight) {
      if (endTime === 0) {
        endTime = x[i];
        endSample = i;
      }
      
      startTime = x[i];
      startSample = i;
    }
    else {
      if (endTime > 0) {
        break;
      }
    }
  }

  //lets also get the time averaged weight
  let totalWeightSeconds = 0;
  for (let i=startSample; i<endSample-1; i++) {
    let sampleStart = x[i]/1000;
    let sampleEnd = x[i+1]/1000;
    let sampleValue = (y[i] + y[i+1])/2;
    totalWeightSeconds += (sampleEnd - sampleStart) * sampleValue;
  }

  let hangTime = (endTime - startTime)/1000;
  let hangWeight = (hangTime>0)?totalWeightSeconds/hangTime:0
  
  return({hangTime: hangTime, hangWeight: hangWeight});
}

async function main() {
  do {
    let response = await fetch('./api');
    let result = await response.json();
    console.log(result);

    let scaleFactor0 = 30;
    let scaleFactor = -180;
    let offset = 0.011;

    let weightFraction = ((result?.right?.value ?? 0) + (result?.left?.value ?? 0)) / scaleFactor0;
    let total = Math.min(Math.abs(weightFraction + offset), 1);
    let height = total * 60;

    let value = (weightFraction + offset) * scaleFactor;

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

    let htmlResult = `
      <div style="display: table; text-align: center; position: absolute; top: 20vh; left: 40vw; width: 20vw; height: ${height}vh; background-color: ${weightFraction < 0 ? 'blue' : 'green'}; color: white; font-weight: bold; font-size: 2em">
        <div style="display: table-cell; text-align: center;  color: white; font-weight: bold; font-size: 2em">
          ${hangWeight>0?hangWeight.toFixed(1):Math.abs(value).toFixed(3)}<br/>${hangTime.toFixed(1)}
        </div>
      </div>
    `;
    document.getElementById("content").innerHTML = htmlResult;
    await sleep(50);
  } while (true);
} 