// Tree-shaken ECharts build: register only what we use. Loaded lazily (see app.config.ts),
// so charts don't slow down the first page load. Add chart types/components here as needed.
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export default echarts;
