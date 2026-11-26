// Store.ts
import { createStore } from "vuex";
import dayjs from "dayjs";
import dayOfYear from "dayjs/plugin/dayOfYear";
dayjs.extend(dayOfYear);

import { DailyStatisticsDataManagerInstance } from "@/data/StatisticsDataManager";

interface StatisticsData {
  // // yyyy-mm
  currentDay: string;
  currentMonth: string;
  // 开启计划
  enablePlan: boolean;
  // 周开始
  weekStart: number;
  // 每日统计
  dayCounts: Record<string, number>;
  // 周计划
  weeklyPlan: Record<string, number>;
  
}


function getGoalOfWeek(weeklyPlan: Record<string, number>, year: string, weekCount: number) {
  if (weekCount <= 0) {
    return 0;
  }
  const number = weeklyPlan[year + "_" + weekCount];
  if (number != undefined) {
    return number;
  }
  // 获取上一周的目标，
  return getGoalOfWeek(weeklyPlan, year, weekCount - 1);
}

const store = createStore<StatisticsData>({


  state: {
    currentDay: "2024-01-01",
    currentMonth: "2024-01",
    weekStart: 0,
    enablePlan: true,
    dayCounts: {},
    weeklyPlan: {}
  },
  getters: {

    currentDay(state) {
      return state.currentDay;
    },

    month(state) {
      return state.currentMonth;
    },

    enablePlan(state) {
      return state.enablePlan;
    },

    weekStart(state) {
      return state.weekStart;
    },

    // 返回当前月份与前后各一个月的数据
    threeMonthsData(state) {
      // // // console.log("getByMonth", state.month, state.dayCounts);
      // return state.dayCounts;

      // 获取指定月份的上一月和下一月
      const prevMonth = dayjs(state.currentMonth).subtract(1, "month").format("YYYY-MM");
      const nextMonth = dayjs(state.currentMonth).add(1, "month").format("YYYY-MM");

      const monthData: Record<string, number> = {};
      for (const date in state.dayCounts) {
        if (date.startsWith(state.currentMonth) || date.startsWith(prevMonth) || date.startsWith(nextMonth)) {
          monthData[date] = state.dayCounts[date];
        }
      }
      // // // console.log("getByMonth", state.month, monthData);
      return monthData;
    },


    // 获取本周目标
    weeklyGoal(state) {
      const weekCount = dayjs(state.currentDay).week();
      return getGoalOfWeek(state.weeklyPlan, dayjs().format("YYYY"), weekCount);
    },


    /**
     * 三个月内的每日计划
     * @param state
     */
    threeMonthsDayPlan(state) {
      const dailyGoals: Record<string, number> = {};
      const currentYear = dayjs(state.currentMonth).year();
      const currentMonth = dayjs(state.currentMonth).month();

      const prevMonthStart = dayjs(state.currentMonth).subtract(1, "month").startOf("month").dayOfYear();
      const nextMonthEnd = dayjs(state.currentMonth).add(1, "month").endOf("month").dayOfYear();
      const endOfYear = dayjs().endOf("year").dayOfYear();

      // console.log("prevMonthStart", prevMonthStart, "nextMonthEnd", nextMonthEnd);

      if (prevMonthStart <= nextMonthEnd) {
        // 不跨年情况
        for (let i = prevMonthStart; i <= nextMonthEnd; i++) {
          const date = dayjs().dayOfYear(i).year(currentYear);
          const weekCount = date.week();
          const number = getGoalOfWeek(state.weeklyPlan, date.format("YYYY"), weekCount);
          // console.info("dailyGoals", date.format("YYYY-MM-DD"), "weekCount", weekCount, number);
          dailyGoals[date.format("YYYY-MM-DD")] = Math.floor(number / 7);
        }
      } else {
        // 跨年情况
        // 处理从 prevMonthStart 到年底的日期
        for (let i = prevMonthStart; i <= endOfYear; i++) {
          let date;
          if (currentMonth == 1) {
            date = dayjs().dayOfYear(i).year(currentYear - 1); // 设置为上一年
          } else {
            date = dayjs().dayOfYear(i).year(currentYear); // 设置为当前年
          }
          const weekCount = date.week();
          const number = getGoalOfWeek(state.weeklyPlan, date.format("YYYY"), weekCount);
          // console.info("dailyGoals", date.format("YYYY-MM-DD"), "weekCount", weekCount, number);
          dailyGoals[date.format("YYYY-MM-DD")] = Math.floor(number / 7);
        }

        // 处理从年初到 nextMonthEnd 的日期
        for (let i = 1; i <= nextMonthEnd; i++) {
          const date = dayjs().dayOfYear(i).year(currentYear); // 设置为当前年
          const weekCount = date.week();
          const number = getGoalOfWeek(state.weeklyPlan, date.format("YYYY"), weekCount);
          // console.info("dailyGoals", date.format("YYYY-MM-DD"), "weekCount", weekCount, number);
          dailyGoals[date.format("YYYY-MM-DD")] = Math.floor(number / 7);
        }
      }

      // console.log("dailyGoals", dailyGoals);
      return dailyGoals;
    },

    // 获取每月目标
    monthlyGoal(state) {
      let monthlyGoal = 0;
      // 获取当前月份的第一天
      const monthStart = dayjs(state.currentMonth).startOf("month").dayOfYear();
      // 获取当前月份的最后一天
      const monthEnd = dayjs(state.currentMonth).endOf("month").dayOfYear();
      // 找出每一天的目标，进行累加
      for (let i = monthStart; i <= monthEnd; i++) {
        const date = dayjs().dayOfYear(i);
        const weekCount = date.week();
        const number = getGoalOfWeek(state.weeklyPlan, date.format("YYYY"), weekCount);
        // console.log("monthlyGoal", date.format("YYYY-MM-DD"), "weekCount", weekCount, number / 7);
        monthlyGoal += Math.floor(number / 7);
      }
      // console.log("month is ", state.currentMonth, "monthlyGoal", monthlyGoal, "monthStart is ", dayjs().dayOfYear(monthStart).format("YYYY-MM-DD"), "monthEnd is ", dayjs().dayOfYear(monthEnd).format("YYYY-MM-DD"));
      return monthlyGoal;
    }


  },
  mutations: {

    updateDay(state, day: string) {
      // console.log("updateDay", day);
      state.currentDay = day;
    },

    updateMonth(state, month: string) {
      state.currentMonth = month;
    },

    updateEnablePlan(state, enablePlan: boolean) {
      state.enablePlan = enablePlan;
    },

    updateWeekStart(state, weekStart: number) {
      state.weekStart = weekStart;
    },

    updateStatisticsData(state, dayCounts: Record<string, number>) {
      state.dayCounts = { ...dayCounts };
    },


    updateWeeklyPlan(state, weeklyPlan: Record<string, number>) {
      // console.log("updateWeeklyPlan, weeklyPlan is ", weeklyPlan);
      const assign = Object.assign(
        state.weeklyPlan,
        weeklyPlan
      );
      state.weeklyPlan = { ...assign };

      // console.log("updateWeeklyPlan, state.weeklyPlan is ", state.weeklyPlan);


      DailyStatisticsDataManagerInstance.data.weeklyPlan = state.weeklyPlan;
      DailyStatisticsDataManagerInstance.saveStatisticsData().then();
    },

    // 更新每日字数
    updateDayCounts(state, dayCounts: Record<string, number>) {
      // 获取dayCounts 第一个属性的名称
      const day = Object.keys(dayCounts)[0];
      if (DailyStatisticsDataManagerInstance.data.offlineLedger) {
        DailyStatisticsDataManagerInstance.setDayCount(day, dayCounts[day]);
        state.dayCounts = {...DailyStatisticsDataManagerInstance.data.dayCounts};
        void DailyStatisticsDataManagerInstance.saveStatisticsData();
        return;
      }
      // 如果修改的时间是当前日期，需要单独做处理，记录在已有字数基础上，变更的数字
      if (dayjs(day).isSame(dayjs(), "day")) {
        DailyStatisticsDataManagerInstance.updateCurrentWordCount(dayCounts[day]);
      }

      const assign = Object.assign(
        state.dayCounts,
        dayCounts
      );
      state.dayCounts = { ...assign };
      DailyStatisticsDataManagerInstance.data.dayCounts = state.dayCounts;
      DailyStatisticsDataManagerInstance.saveStatisticsData().then();
    },

    /**
     * 所有数据刷新
     */
    refreshAllData() {
      DailyStatisticsDataManagerInstance.loadStatisticsData();
    }


  }
});

export default store;
