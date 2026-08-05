import "./style.css";
import defaultHolidayCsv from "../data/japan_holidays_2025FY-2027FY.csv?raw";
import { App } from "./ui/App";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("#app 要素が見つかりません。");
}

new App(root, defaultHolidayCsv);
