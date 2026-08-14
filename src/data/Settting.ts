export class DailyStatisticsSettings {
  dataFile = ".obsidian/plugins/daily-statistics/statistics-data.json";
  // 需要统计字数的文件夹，如果为空，则统计全库的数据
  statisticsFolder = "";
  // 排除文件夹
  excludeFolder = "";

  // 统计单词，用于英文场景
  statisticsWord = true;
  // 开启计划
  enablePlan = true;
  // 一周开始时间
  weekStart = 0;
}
