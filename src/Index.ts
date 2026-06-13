import {
  debounce,
  type Debouncer,
  Editor,
  type MarkdownFileInfo,
  MarkdownView,
  Plugin,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { DailyStatisticsSettings } from "@/data/Settting";
import { DailyStatisticsDataManagerInstance } from "@/data/StatisticsDataManager";
import { CalendarView, Calendar_View } from "@/ui/calendar/CalendarView";
import { SampleSettingTab } from "@/ui/setting/SampleSettingTab";
import i18n from "@/lang";
import dayjs from "dayjs";


/**
 * 插件核心类
 */
export default class DailyStatisticsPlugin extends Plugin {
  settings!: DailyStatisticsSettings;
  debouncedUpdate!: Debouncer<[contents: string | null, filepath: string], void>;
  private statusBarItemEl!: HTMLElement;
  calendarView!: CalendarView;
  private dailyWordCountReplacementRunning = false;
  private vaultWordCountScanRunning = false;

  async onload() {
    await this.loadSettings();

    // 尽早的设置时间地域
    const locale = i18n.global.locale.value;
    if (locale == "zh_cn") {
      dayjs.locale("zh-cn", {
        weekStart: this.settings.weekStart
      });
    } else {
      dayjs.locale("en", {
        weekStart: this.settings.weekStart
      });
    }

    const t = i18n.global.t;

    DailyStatisticsDataManagerInstance.init(
      this.settings.dataFile,
      this.app,
      this
    );
    DailyStatisticsDataManagerInstance.loadStatisticsData()
      .then(() => {
        // 数据加载完成之后，再创建视图
        setTimeout(() => {
          try {
            this.registerView(Calendar_View, (leaf) => {
              this.calendarView = new CalendarView(leaf, this);
              return this.calendarView;
            });
          } catch (e) {
            console.error("registerView error", e);
          }

          this.openForTheFirstTime();
        }, 500);


        // 检查文件的修改时间
        this.registerInterval(
          window.setInterval(() => {
            DailyStatisticsDataManagerInstance.getFileModifiedTime().then((time) => {
              if (time > DailyStatisticsDataManagerInstance.dataSynchronTime) {
                console.log("loadStatisticsData, fileModifiedTime is " + time + ", dataSynchronTime is " + DailyStatisticsDataManagerInstance.dataSynchronTime);
                DailyStatisticsDataManagerInstance.loadStatisticsData();

              }
            });
          }, 1000)
        );


        this.prepareActiveFileBaseline().then(() => {
          this.scanAllMarkdownWordCounts().then();
        });
        this.registerInterval(
          window.setInterval(() => {
            this.scanAllMarkdownWordCounts().then();
          }, 15000)
        );

      })
      .catch((e) => {
        console.error("loadStatisticsData error", e);
      });

    this.debouncedUpdate = debounce<[contents: string | null, filepath: string], void>(
      (contents: string | null, filepath: string) => {

        if (filepath == null || filepath == "") {
          console.warn("filepath is null or empty, not update");
          return;
        }

        // 排除文件夹
        if (this.settings.excludeFolder != null && this.settings.excludeFolder != "" && this.settings.excludeFolder != "/") {
          // 支持多个文件夹排除，使用逗号分隔
          const folders = this.settings.excludeFolder.split(',').map(folder => folder.trim()).filter(folder => folder !== "");

          // 构建匹配多个文件夹的正则表达式
          const folderPatterns = folders.map(folder => `^${folder}(/|$)`);
          const excludePattern = new RegExp(folderPatterns.join('|'));

          if (filepath.match(excludePattern)) {
            // console.log("排除文件夹，不统计数据: " + filepath);
            return;
          }
        }

        if (
          this.settings.statisticsFolder != null &&
          this.settings.statisticsFolder != "" &&
          this.settings.statisticsFolder != "/"
        ) {
          // 支持多个文件夹包含，使用逗号分隔
          const folders = this.settings.statisticsFolder.split(',').map(folder => folder.trim()).filter(folder => folder !== "");

          // 构建匹配多个文件夹的正则表达式
          const folderPatterns = folders.map(folder => `^${folder}(/|$)`);
          const includePattern = new RegExp(folderPatterns.join('|'));

          if (!filepath.match(includePattern)) {
            // console.log("文件路径不匹配，不统计: " + filepath);
            return;
          }
        }
        if (!this.shouldTrackStatisticsFile(filepath)) {
          return;
        }

        if (contents != null) {
          DailyStatisticsDataManagerInstance.updateVaultWordCount(contents, filepath);
        } else {
          this.scanAllMarkdownWordCounts().then();
        }
      },
      400,
      false
    );

    // 定时在的状态栏更新本日字数
    this.statusBarItemEl = this.addStatusBarItem();
    // statusBarItemEl.setText('Status Bar Text');
    this.registerInterval(
      window.setInterval(() => {
        this.statusBarItemEl.setText(
          t("todaySWordCount") +
          DailyStatisticsDataManagerInstance.currentWordCount
        );
      }, 1000)
    );

    this.registerInterval(
      window.setInterval(() => {
        this.updateDailyWordCountPlaceholders().then();
      }, 15000)
    );
    this.updateDailyWordCountPlaceholders().then();

    // 在快速预览时，更新统计数据
    this.registerEvent(
      this.app.workspace.on("editor-change", this.onEditorChange.bind(this))
    );
    // 当文件被打开时，便统计一次字数
    this.registerEvent(
      this.app.workspace.on("file-open", this.onFileOpen.bind(this))
    );

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SampleSettingTab(this.app, this));

    this.addCommand({
      id: "open-calendar",
      name: t("openTheCalendarPanel"),
      callback: () => {
        this.activateView();
      },
    });
  }

  // // 自定义方法，通过 workspace API 检查视图类型是否已经加载
  // isViewAlreadyLoaded(viewType) {
  //   const leaves = this.app.workspace.getLeavesOfType(viewType);
  //   return leaves.length > 0; // 如果有至少一个已存在的视图，返回 true
  // }

  /**
   * 启动检查，如果是初次安装，则默认打开窗口
   * @private
   */
  private async openForTheFirstTime() {
    setTimeout(() => {
      const { workspace } = this.app;

      // console.log("workspace", workspace);

      const leaves = workspace.getLeavesOfType(Calendar_View);
      // 初次使用时，没有侧边栏按钮，则打开一个
      // console.log("leaves", leaves);
      if (leaves.length == 0) {
        this.activateView();
      }
    }, 500);
  }

  onunload() {
    this.statusBarItemEl.remove();
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(Calendar_View);
    if (leaves.length > 0) {
      leaves[0].detach();
    }
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null;
    const leaves = workspace.getLeavesOfType(Calendar_View);

    if (leaves.length > 0) {
      // A leaf with our view already exists, use that
      leaf = leaves[0];
    } else {
      // Our view could not be found in the workspace, create a new leaf
      // in the right sidebar for it
      leaf = workspace.getRightLeaf(false);
      if (leaf == null) {
        console.error("leaf is null");
        return;
      }
      await leaf.setViewState({ type: Calendar_View, active: true });
    }

    // "Reveal" the leaf in case it is in a collapsed sidebar
    workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      new DailyStatisticsSettings(),
      await this.loadData()
    );
  }

  // 保存配置文件
  async saveSettings() {
    // 先获取最新的数据，再将新的配置保存进去
    let data = await this.loadData();
    if (data == null) {
      data = new DailyStatisticsSettings();
    }
    Object.assign(data, this.settings);
    await this.saveData(data);
  }

  // 在预览时更新统计字数
  onEditorChange(editor: Editor, info: MarkdownView | MarkdownFileInfo) {
    const file = info.file ?? this.app.workspace.getActiveFile();
    if (file) {
      this.debouncedUpdate(editor.getValue(), file.path);
    }
  }

  // 当文件被打开时统计字数
  onFileOpen(file: TFile | null) {
    if (file && this.app.workspace.getActiveViewOfType(MarkdownView)) {
      this.prepareFileBaseline(file).then(() => {
        this.scanAllMarkdownWordCounts().then();
      });
    }
  }

  private async prepareActiveFileBaseline() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile == null) {
      return;
    }

    await this.prepareFileBaseline(activeFile);
  }

  private async prepareFileBaseline(file: TFile) {
    if (!this.shouldTrackStatisticsFile(file.path)) {
      return;
    }

    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const contents = activeMarkdownView?.file?.path == file.path
      ? activeMarkdownView.editor.getValue()
      : await this.app.vault.read(file);

    DailyStatisticsDataManagerInstance.prepareVaultWordCountBaseline(contents, file.path);
  }

  private normalizeVaultPath(filepath: string | null | undefined) {
    return (filepath || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  }

  private isPluginInternalFile(filepath: string) {
    return filepath.startsWith(".obsidian/")
      || filepath.startsWith("_dev-tools/")
      || filepath.split("/").some(part => part.startsWith("."));
  }

  private shouldTrackStatisticsFile(filepath: string) {
    filepath = this.normalizeVaultPath(filepath);
    if (filepath == "") {
      return false;
    }

    if (this.isPluginInternalFile(filepath)) {
      return false;
    }

    const dataFile = this.normalizeVaultPath(this.settings.dataFile);
    if (dataFile != "" && filepath == dataFile) {
      return false;
    }

    if (this.settings.excludeFolder != null && this.settings.excludeFolder != "" && this.settings.excludeFolder != "/") {
      const folders = this.settings.excludeFolder.split(',').map(folder => this.normalizeVaultPath(folder)).filter(folder => folder !== "");
      const folderPatterns = folders.map(folder => `^${folder}(/|$)`);
      const excludePattern = new RegExp(folderPatterns.join('|'));

      if (filepath.match(excludePattern)) {
        return false;
      }
    }

    if (
      this.settings.statisticsFolder != null &&
      this.settings.statisticsFolder != "" &&
      this.settings.statisticsFolder != "/"
    ) {
      const folders = this.settings.statisticsFolder.split(',').map(folder => this.normalizeVaultPath(folder)).filter(folder => folder !== "");
      const folderPatterns = folders.map(folder => `^${folder}(/|$)`);
      const includePattern = new RegExp(folderPatterns.join('|'));

      if (!filepath.match(includePattern)) {
        return false;
      }
    }

    return true;
  }

  private async scanAllMarkdownWordCounts() {
    if (this.vaultWordCountScanRunning) {
      return;
    }

    this.vaultWordCountScanRunning = true;
    try {
      const wordCounts: Record<string, number> = {};
      const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
      const activeFilePath = activeMarkdownView?.file?.path;
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!this.shouldTrackStatisticsFile(file.path)) {
          continue;
        }

        const contents = file.path == activeFilePath
          ? activeMarkdownView.editor.getValue()
          : await this.app.vault.read(file);
        wordCounts[file.path] = DailyStatisticsDataManagerInstance.getWordCount(contents);
      }

      DailyStatisticsDataManagerInstance.updateVaultWordCounts(wordCounts);
    } catch (error) {
      console.error("scanAllMarkdownWordCounts error", error);
    } finally {
      this.vaultWordCountScanRunning = false;
    }
  }

  private getDailyWordCountReplacement() {
    const count = DailyStatisticsDataManagerInstance.currentWordCount || 0;
    return `Total daily word count (${DailyStatisticsDataManagerInstance.today}): ${count}`;
  }

  private async updateDailyWordCountPlaceholders() {
    if (this.dailyWordCountReplacementRunning) {
      return;
    }

    this.dailyWordCountReplacementRunning = true;
    const placeholder = "<todaystotalwordcount>";
    const today = DailyStatisticsDataManagerInstance.today;
    const generatedTextPattern = new RegExp(`Total daily word count \\(${today}\\): \\d+`, "g");
    const undatedGeneratedTextPattern = /Total daily word count: \d+/g;
    const replacement = this.getDailyWordCountReplacement();

    try {
      for (const file of this.app.vault.getMarkdownFiles()) {
        const filepath = this.normalizeVaultPath(file.path);
        const dataFile = this.normalizeVaultPath(this.settings.dataFile);
        if (this.isPluginInternalFile(filepath) || (dataFile != "" && filepath == dataFile)) {
          continue;
        }

        const contents = await this.app.vault.cachedRead(file);
        generatedTextPattern.lastIndex = 0;

        if (!contents.includes(placeholder) && !generatedTextPattern.test(contents) && !undatedGeneratedTextPattern.test(contents)) {
          continue;
        }

        generatedTextPattern.lastIndex = 0;
        undatedGeneratedTextPattern.lastIndex = 0;
        const updatedContents = contents
          .replaceAll(placeholder, replacement)
          .replace(generatedTextPattern, replacement)
          .replace(undatedGeneratedTextPattern, replacement);

        if (updatedContents !== contents) {
          await this.app.vault.modify(file, updatedContents);
        }
      }
    } catch (error) {
      console.error("updateDailyWordCountPlaceholders error", error);
    } finally {
      this.dailyWordCountReplacementRunning = false;
    }
  }
}
