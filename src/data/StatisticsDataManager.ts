import { App, Plugin, TFile } from "obsidian";
import { DailyStatisticsSettings } from "./Settting";
import dayjs from "dayjs";
import DailyStatisticsPlugin from "@/Index";

export interface WordCount {
  initial: number;
  current: number;
}

/**
 * 统计数据
 */
export class DailyStatisticsData {
  dayCounts: Record<string, number> = {};
  todayWordCount: Record<string, WordCount> = {};
  vaultBaselineDate = "";
  vaultBaselineWordCounts: Record<string, number> = {};
  vaultLatestWordCounts: Record<string, number> = {};
  // 每周计划
  weeklyPlan: Record<string, number> = {};
  // 当日手动修改的字数
  currentManuallyModifyWordCount: number = 0;
}

export class DailyStatisticsDataManager {
  filePath = "";
  file!: TFile | null;
  today!: string;
  currentWordCount!: number;
  dataSaveListeners: DailyStatisticsDataSaveListener[] = [];
  dataSyncListeners: DailyStatisticsDataSyncListener[] = [];
  app!: App;
  data: DailyStatisticsData;
  plugin!: DailyStatisticsPlugin;  // 修改类型为 DailyStatisticsPlugin

  loadingData = false;


  /**
   * 数据同步时间(ms) 
   * 这个变量的作用是为了处理多端数据同步时的冲突。
   * 每次更新数据文件时，更新这个时间。
   * 定时检查数据文件的修改时间，如果与系统中记录的时间不一致，则说明文件被外部程序修改了，则重新从文件中加载数据。
   */
  dataSynchronTime: number = 0;

  constructor() {
    // 给一个默认值，避免出错
    this.data = new DailyStatisticsData();
  }

  init(dataFile: string, app: App, plugin: DailyStatisticsPlugin) {  // 修改参数类型
    this.filePath = dataFile;
    this.app = app;
    this.plugin = plugin;
  }


  /**
   * 加载数据
   */
  async loadStatisticsData() {
    this.loadingData = false;
    //    console.log("loadStatisticsData, filePath is " + this.filePath);

    // 如果配置文件为空，则从默认的设置中加载杜
    if (this.filePath == null || this.filePath == "") {
      this.data = Object.assign(
        new DailyStatisticsData(),
        await this.plugin.loadData()
      );
      // 移除配置相关的属性
      this.removeProperties(this.data, new DailyStatisticsSettings());
    } else {
      // 循环5次
      for (let i = 0; i < 10; i++) {
        this.file = this.app.vault.getFileByPath(this.filePath);
        if (this.file != null) {
          // console.log("dataFile ready");
          break;
        }
        // console.log("waiting for dataFile…… ");
        // 等待3秒
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      this.file = this.app.vault.getFileByPath(this.filePath);
      if (this.file == null) {
        console.log("create dataFile " + this.filePath);
        this.file = await this.app.vault.create(
          this.filePath,
          JSON.stringify(new DailyStatisticsData())
        );
      }
      this.data = Object.assign(
        new DailyStatisticsData(),
        await JSON.parse(await this.app.vault.read(this.file))
      );
      // console.log("loadStatisticsData, data is " + JSON.stringify(this.data));
    }

    this.updateDate();
    if (Object.prototype.hasOwnProperty.call(this.data.dayCounts, this.today)) {
      this.updateCounts();
    } else {
      // 如果记录中，没有当前日期的记录，则说明是新的一天，更新每日字数，和初始化记录
      this.data.todayWordCount = {};
      this.currentWordCount = 0;
      this.data.currentManuallyModifyWordCount = 0;
    }
    this.afterDataSync();

    this.dataSynchronTime = Date.now();
    this.loadingData = true;
  }

  // 获取当前数据文件的更新时间
  async getFileModifiedTime(): Promise<number> {
    if (this.file == null) {
      // 如果文件为空，则说明使用的插件的默认数据配置，这种情况下，不能进行同步，也不需要进行比较，所以返回 0
      return 0;
    }
    const stats = await this.app.vault.adapter.stat(this.file.path);
    return stats?.mtime ?? 0;
  }




  removeProperties(
    obj: Record<string, any>,
    propsToRemove: Record<string, any>
  ): void {
    // 获取要删除属性的名称数组
    const keysToRemove = Object.keys(propsToRemove);

    // 遍历要删除的属性名称，并从原始对象中删除它们
    keysToRemove.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        delete obj[key];
      }
    });
  }

  addDataSaveListener(listener: DailyStatisticsDataSaveListener) {
    this.dataSaveListeners.push(listener);
  }

  addDataSyncListener(listener: DailyStatisticsDataSyncListener) {
    this.dataSyncListeners.push(listener);
  }


  // 移除数据监听器
  removeDataSaveListener(listener: DailyStatisticsDataSaveListener) {
    this.dataSaveListeners = this.dataSaveListeners.filter(
      (item) => item.getListenerId() !== listener.getListenerId()
    );
  }

  removeDataSyncListener(listener: DailyStatisticsDataSyncListener) {
    this.dataSyncListeners = this.dataSyncListeners.filter(
      (item) => item.getListenerId() !== listener.getListenerId()
    );
  }

  // 保存数据
  async saveStatisticsData() {
    try {
      if (!this.loadingData) {
        return;
      }
      this.updateDate();
      if (this.filePath != null && this.filePath != "") {
        if (this.file == null) {
          this.file = await this.app.vault.create(
            this.filePath,
            JSON.stringify(this.data)
          );
        }
        // console.log("saveStatisticsData, data is " + JSON.stringify(this.data));
        await this.app.vault.modify(this.file, JSON.stringify(this.data));
      } else {
        let data = await this.plugin.loadData();
        // // // console.log("saveStatisticsData, data is " + JSON.stringify(data));
        if (data == null) {
          data = {};
        }
        Object.assign(data, this.data);
        await this.plugin.saveData(data);
      }
      this.dataSynchronTime = Date.now();

      // 异步执行监听器，数据保存之后的回调
      this.afterDataSave();
    } catch (error) {
      console.error("保存统计数据出错：", error);
    }
  }



  /**
  * 异步执行监听器，数据保存之后的回调
  */
  afterDataSave() {
    new Promise(() => {
      for (const listener of this.dataSaveListeners) {
        try {
          listener.onSave(this.data);
          // // // console.log("dataSaveListener 执行完成, listenerId is " + listener.getListenerId());
        } catch (error) {
          console.error(
            "dataSaveListeners, 执行异常, listenerId is " +
            listener.getListenerId(),
            error
          );
        }
      }
    });
  }

  /**
   * 异步执行监听器，数据同步之后的回调
   */
  afterDataSync() {
    new Promise(() => {
      for (const listener of this.dataSyncListeners) {
        try {
          listener.onSync(this.data);
        } catch (error) {
          console.error("dataSyncListeners, 执行异常, listenerId is " + listener.getListenerId(), error);
        }
      }
    });
  }

  /**
   * 统计字数
   * @param text
   */
  getWordCount(text: string) {
    text = this.getCountableText(text);
    if (this.plugin.settings.statisticsWord) {
      return this.countTheNumberOfWords(text);
    }
    // 直接统计字数数量
    return text.length;
  }

  private getCountableText(text: string) {
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  }

  /**
   * 统计单词数
   * @param text
   * @private
   */
  private countTheNumberOfWords(text: string) {
    return (text.match(/\S+/g) || []).length;
  }

  async updateWordCount(contents: string | null, filepath: string) {
    if (contents == null || contents.length == 0) {
      const tempFile = this.app.vault.getFileByPath(filepath);
      if (tempFile == null) {
        return;
      }
      contents = await this.app.vault.read(tempFile);
    }
    const curr = this.getWordCount(contents);
    // console.log("updateWordCount", curr);
    if (Object.prototype.hasOwnProperty.call(this.data.dayCounts, this.today)) {
      if (
        Object.prototype.hasOwnProperty.call(this.data.todayWordCount, filepath)
      ) {
        // 当前文件已有记录，则更新当前字数
        this.data.todayWordCount[filepath].current = curr;
      } else {
        // 当前文件没有记录，新增记录
        this.data.todayWordCount[filepath] = { initial: curr, current: curr };
      }
    } else {
      // 新的一天，清空当天的记录
      this.data.todayWordCount = {};
      this.data.todayWordCount[filepath] = { initial: curr, current: curr };
    }
    this.updateCounts();
  }

  updateVaultWordCounts(wordCounts: Record<string, number>) {
    this.updateDate();
    let changed = false;

    if (this.data.vaultBaselineDate !== this.today) {
      const previousSnapshot = Object.keys(this.data.vaultLatestWordCounts || {}).length > 0
        ? this.data.vaultLatestWordCounts
        : wordCounts;

      this.data.vaultBaselineDate = this.today;
      this.data.vaultBaselineWordCounts = { ...previousSnapshot };
      this.data.todayWordCount = {};
      this.data.currentManuallyModifyWordCount = 0;
      changed = true;
    }

    const previousLatestWordCounts = this.data.vaultLatestWordCounts || {};
    if (Object.keys(previousLatestWordCounts).length !== Object.keys(wordCounts).length) {
      changed = true;
    } else {
      for (const filepath in wordCounts) {
        if (previousLatestWordCounts[filepath] !== wordCounts[filepath]) {
          changed = true;
          break;
        }
      }
    }

    if (!changed) {
      return;
    }

    const nextTodayWordCount: Record<string, WordCount> = {};

    for (const filepath in wordCounts) {
      let current = wordCounts[filepath];
      const existingTodayWordCount = this.data.todayWordCount[filepath];
      if (
        existingTodayWordCount != null &&
        existingTodayWordCount.current > current &&
        existingTodayWordCount.current > existingTodayWordCount.initial
      ) {
        current = existingTodayWordCount.current;
        wordCounts[filepath] = current;
      }
      const baseline = this.getVaultBaselineForFile(filepath, current, previousLatestWordCounts);
      this.data.vaultBaselineWordCounts[filepath] = baseline;
      nextTodayWordCount[filepath] = { initial: baseline, current };
    }

    this.data.todayWordCount = nextTodayWordCount;
    this.data.vaultLatestWordCounts = { ...wordCounts };
    this.updateCounts();
  }

  updateVaultWordCount(contents: string, filepath: string, baselineOverride?: number) {
    this.updateDate();
    const current = this.getWordCount(contents);
    const previousLatestWordCounts = this.data.vaultLatestWordCounts || {};

    if (this.data.vaultBaselineDate !== this.today) {
      this.data.vaultBaselineDate = this.today;
      this.data.vaultBaselineWordCounts = { ...previousLatestWordCounts };
      this.data.todayWordCount = {};
      this.data.currentManuallyModifyWordCount = 0;
    }

    const baseline = baselineOverride ?? this.getVaultBaselineForFile(filepath, current, previousLatestWordCounts);
    this.data.vaultBaselineWordCounts[filepath] = baseline;

    const previousCount = previousLatestWordCounts[filepath];
    const previousTodayWordCount = this.data.todayWordCount[filepath];
    if (
      previousCount === current &&
      previousTodayWordCount?.initial === baseline &&
      previousTodayWordCount?.current === current
    ) {
      return;
    }

    this.data.todayWordCount[filepath] = { initial: baseline, current };
    this.data.vaultLatestWordCounts = {
      ...previousLatestWordCounts,
      [filepath]: current,
    };
    this.updateCounts();
  }

  prepareVaultWordCountBaseline(contents: string, filepath: string) {
    this.updateDate();
    const current = this.getWordCount(contents);
    const previousLatestWordCounts = this.data.vaultLatestWordCounts || {};

    if (this.data.vaultBaselineDate !== this.today) {
      this.data.vaultBaselineDate = this.today;
      this.data.vaultBaselineWordCounts = { ...previousLatestWordCounts };
      this.data.todayWordCount = {};
      this.data.currentManuallyModifyWordCount = 0;
    }

    const existingTodayWordCount = this.data.todayWordCount[filepath];
    if (
      existingTodayWordCount != null &&
      existingTodayWordCount.current !== existingTodayWordCount.initial
    ) {
      return existingTodayWordCount.initial;
    }

    this.data.vaultBaselineWordCounts[filepath] = current;
    this.data.todayWordCount[filepath] = { initial: current, current };
    this.data.vaultLatestWordCounts = {
      ...previousLatestWordCounts,
      [filepath]: current,
    };
    this.updateCounts();
    return current;
  }

  private getVaultBaselineForFile(
    filepath: string,
    current: number,
    previousLatestWordCounts: Record<string, number>
  ) {
    if (Object.prototype.hasOwnProperty.call(this.data.vaultBaselineWordCounts, filepath)) {
      return this.data.vaultBaselineWordCounts[filepath];
    }

    if (Object.prototype.hasOwnProperty.call(this.data.todayWordCount, filepath)) {
      return this.data.todayWordCount[filepath].initial;
    }

    if (Object.prototype.hasOwnProperty.call(previousLatestWordCounts, filepath)) {
      return previousLatestWordCounts[filepath];
    }

    return current;
  }

  updateDate() {
    this.today = dayjs().format("YYYY-MM-DD");
  }

  updateCounts() {

    this.currentWordCount = Object.values(this.data.todayWordCount)
      .map((wordCount) => Math.max(0, (wordCount.current || 0) - (wordCount.initial || 0)))
      .reduce((a, b) => a + b, 0);
    // console.log("currentWordCount", this.currentWordCount);
    this.currentWordCount += this.data.currentManuallyModifyWordCount;
    this.currentWordCount = Math.max(0, this.currentWordCount);
    this.data.dayCounts[this.today] = this.currentWordCount;
    // console.log("updateCounts", this.data);
    this.saveStatisticsData().then();
  }

  updateCurrentWordCount(wordCount: number) {
    // 先减去旧的手动值，得到真实值
    const actualValue =
      this.currentWordCount - this.data.currentManuallyModifyWordCount;
    // 然后再根据真实值，计算新的手动值
    this.data.currentManuallyModifyWordCount = wordCount - actualValue;
    this.currentWordCount = wordCount;
  }

  /**
   * 重置当日统计数据
   */
  resetCurrentDayStatistics() {
    this.data.todayWordCount = {};
    this.updateCounts();
  }
}

/**
 * 保存数据监听
 */
export interface DailyStatisticsDataSaveListener {
  onSave(data: DailyStatisticsData): void;

  getListenerId(): string;
}

/**
 * 数据同步监听
 */
export interface DailyStatisticsDataSyncListener {
  onSync(data: DailyStatisticsData): void;
  getListenerId(): string;
}



export const DailyStatisticsDataManagerInstance: DailyStatisticsDataManager =
  new DailyStatisticsDataManager();
