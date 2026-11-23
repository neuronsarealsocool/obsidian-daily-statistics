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
  private updatingDailyTotalPlaceholders = false;
  private recountingVault = false;
  private stopped = false;
  calendarView!: CalendarView;

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

        this.app.workspace.onLayoutReady(() => {
          void this.recountVault();
        });
        this.registerInterval(
          window.setInterval(() => {
            void this.recountVault();
          }, 15_000)
        );


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

        if (!this.shouldCountFile(filepath)) return;
        DailyStatisticsDataManagerInstance.updateWordCount(contents, filepath);
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

    // 在快速预览时，更新统计数据
    this.registerEvent(
      this.app.workspace.on("editor-change", this.onEditorChange.bind(this))
    );
    // 当文件被打开时，便统计一次字数
    this.registerEvent(
      this.app.workspace.on("file-open", this.onFileOpen.bind(this))
    );
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      const counts = DailyStatisticsDataManagerInstance.data.todayWordCount;
      for (const path of Object.keys(counts)) {
        if (path === oldPath || path.startsWith(`${oldPath}/`)) {
          const newPath = file.path + path.slice(oldPath.length);
          counts[newPath] = counts[path];
          delete counts[path];
        }
      }
    }));

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
    this.stopped = true;
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

  private getDailyTotalWordCountText(date: string): string {
    const count = DailyStatisticsDataManagerInstance.data.dayCounts[date] ?? 0;
    return `Total daily word count (${date}): ${count}`;
  }

  private async recountVault() {
    if (this.recountingVault || this.stopped) return;
    this.recountingVault = true;
    try {
      await DailyStatisticsDataManagerInstance.recountVault(() => this.stopped);
      if (!this.stopped) await this.updateDailyTotalWordCountPlaceholders();
    } catch (error) {
      console.error("Error recounting vault words:", error);
    } finally {
      this.recountingVault = false;
    }
  }

  shouldCountFile(filepath: string): boolean {
    if (this.isTemplateFile(filepath) || filepath === this.settings.dataFile) return false;
    const matches = (setting: string) => setting.split(",")
      .map((folder) => this.normalizePath(folder))
      .filter(Boolean)
      .some((folder) => this.isPathInFolder(filepath, folder));
    const excluded = this.settings.excludeFolder;
    if (excluded && excluded !== "/" && matches(excluded)) return false;
    const included = this.settings.statisticsFolder;
    return !included || included === "/" || matches(included);
  }

  stripDailyTotalWordCountText(contents: string): string {
    return contents
      .replace(/<todaystotalwordcount>/g, "")
      .replace(/Total daily word count \(\d{4}-\d{2}-\d{2}\): -?\d+/g, "");
  }

  private replaceDailyTotalWordCountText(contents: string): string {
    const today = dayjs().format("YYYY-MM-DD");
    return contents
      .replace(/<todaystotalwordcount>/g, this.getDailyTotalWordCountText(today))
      .replace(
        /Total daily word count \((\d{4}-\d{2}-\d{2})\): -?\d+/g,
        (_match, date: string) => this.getDailyTotalWordCountText(date)
      );
  }

  private async updateDailyTotalWordCountPlaceholders() {
    if (this.updatingDailyTotalPlaceholders) {
      return;
    }

    this.updatingDailyTotalPlaceholders = true;
    try {
      const files = this.app.vault
        .getMarkdownFiles()
        .filter((file) => !this.isTemplateFile(file.path));

      for (const file of files) {
        const contents = await this.app.vault.read(file);
        if (
          !contents.includes("<todaystotalwordcount>") &&
          !contents.includes("Total daily word count (")
        ) {
          continue;
        }

        const updatedContents = this.replaceDailyTotalWordCountText(contents);
        if (updatedContents !== contents) {
          await this.app.vault.modify(file, updatedContents);
        }
      }
    } catch (error) {
      console.error("Error updating daily total word count placeholders:", error);
    } finally {
      this.updatingDailyTotalPlaceholders = false;
    }
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

  private normalizePath(path: string): string {
    return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }

  private isPathInFolder(filepath: string, folder: string): boolean {
    return filepath === folder || filepath.startsWith(`${folder}/`);
  }

  private getTemplateFolders(): string[] {
    const folders = new Set<string>(["templates", "template"]);
    const templaterSettings = (this.app as unknown as {
      plugins?: { plugins?: Record<string, { settings?: { templates_folder?: string } }> };
    }).plugins?.plugins?.["templater-obsidian"]?.settings;
    const templaterFolder = this.normalizePath(templaterSettings?.templates_folder ?? "");
    if (templaterFolder) {
      folders.add(templaterFolder);
    }
    return [...folders];
  }

  isTemplateFile(filepath: string): boolean {
    const normalizedPath = this.normalizePath(filepath).toLowerCase();
    if (normalizedPath === "") {
      return false;
    }
    const segments = normalizedPath.split("/");
    if (segments.some((segment) => segment === "template" || segment === "templates")) {
      return true;
    }
    return this.getTemplateFolders()
      .map((folder) => folder.toLowerCase())
      .some((folder) => this.isPathInFolder(normalizedPath, folder));
  }

  // 在预览时更新统计字数
  onEditorChange(editor: Editor, info: MarkdownView | MarkdownFileInfo) {
    if (info instanceof MarkdownView) {
      const file = info.file;
      const contents = editor.getValue();
      if (file) {
        this.debouncedUpdate(contents, file.path);
      }
    } else {
      // console.log("onEditorChange, info is not MarkdownView");
    }
  }

  // 当文件被打开时统计字数
  onFileOpen(file: TFile | null) {
    if (file && this.app.workspace.getActiveViewOfType(MarkdownView)) {
      const isNewEmptyFile = file.stat.size === 0 && Date.now() - file.stat.ctime < 30_000;
      if (isNewEmptyFile) {
        return;
      }
      this.debouncedUpdate(null, file.path);
    }
  }
}
