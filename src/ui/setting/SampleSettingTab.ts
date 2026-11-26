import { App, PluginSettingTab, Setting } from "obsidian";
import DailyStatisticsPlugin from "@/Index";
import { DailyStatisticsDataManagerInstance } from "@/data/StatisticsDataManager";
import dayjs from "dayjs";
import i18n from "@/lang";

import store from "@/data/Store";

/**
 * 设置页面
 */
export class SampleSettingTab extends PluginSettingTab {
  plugin: DailyStatisticsPlugin;

  constructor(app: App, plugin: DailyStatisticsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const t = i18n.global.t;
    containerEl.empty();
    containerEl.createEl('p', {text: 'Offline catch-up is automatic. Android versions and their source dates are imported from _mobile-edit-history when Resilio delivers the recorder journal. Without a journal, net changes use the note modification date as an estimate. Edits overwritten before a recording cannot be recovered.'});

    new Setting(containerEl)
      .setName(t("statisticalDataStorageAddress"))
      .setDesc(t("statisticalDataStorageAddressExplained"))
      .addText((text) =>
        text.setValue(this.plugin.settings.dataFile).onChange(async (value) => {
          this.plugin.settings.dataFile = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("statisticsFolder"))
      .setDesc(t("statisticsFolderExplained"))
      .addText((text) =>
        text
          .setPlaceholder(t("all"))
          .setValue(this.plugin.settings.statisticsFolder)
          .onChange(async (value) => {
            this.plugin.settings.statisticsFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("excludeFolder"))
      .setDesc(t("excludeFolderExplained"))
      .addText((text) =>
        text
          .setPlaceholder(t("no"))
          .setValue(this.plugin.settings.excludeFolder)
          .onChange(async (value) => {
            this.plugin.settings.excludeFolder = value;
            await this.plugin.saveSettings();
          })
      );

      new Setting(containerEl)
      .setName(t("statisticsWord"))
      .setDesc(t("statisticsWordExplained"))
      .addToggle((component) =>
        component
          .setValue(this.plugin.settings.statisticsWord)
          .onChange(async (value) => {
            this.plugin.settings.statisticsWord = value;
            await this.plugin.saveSettings();
            // 将当日的统计数据重置
            DailyStatisticsDataManagerInstance.resetCurrentDayStatistics()
          })
      );


    new Setting(containerEl)
      .setName(t("enablePlan"))
      .setDesc(t("enablePlanExplained"))
      .addToggle((component) =>
        component
          .setValue(this.plugin.settings.enablePlan)
          .onChange(async (value) => {
            this.plugin.settings.enablePlan = value;
            await this.plugin.saveSettings();
            store.commit("updateEnablePlan", value);
          })
      );



    new Setting(containerEl)
      .setName(t("weekStart"))
      .setDesc(t("weekStartExplained"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("0", t("weekStartOptions0"))
          .addOption("1", t("weekStartOptions1")) 
          .addOption("2", t("weekStartOptions2"))
          .addOption("3", t("weekStartOptions3"))
          .addOption("4", t("weekStartOptions4"))
          .addOption("5", t("weekStartOptions5"))
          .addOption("6", t("weekStartOptions6"))
          .setValue(this.plugin.settings.weekStart.toString())
          .onChange(async (value) => {
            this.plugin.settings.weekStart = parseInt(value);
            await this.plugin.saveSettings();
            store.commit("updateWeekStart", parseInt(value));

            // 更新 dayjs.js 配置
            const locale = dayjs.locale();
            if (locale == "zh_cn") {
              dayjs.locale("zh-cn", {
                weekStart: this.plugin.settings.weekStart
              });
            } else {
              dayjs.locale("en", {
                weekStart: this.plugin.settings.weekStart
              });
            }


          })
      );
  }
  
}
