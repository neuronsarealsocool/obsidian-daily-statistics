<template>

  <el-dialog align-center v-model="dialogVisible" :title="$t('modifyWordCount')" :show-close=false width="300">
    <template #default>
      <el-input-number :controls="false" v-model="wordCountPerDay" :min="0" :max="100000" />
    </template>
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="dialogVisible = false">
          {{ $t("Cancel") }}
        </el-button>
        <el-button @click="confirm">
          {{ $t("Confirm") }}
        </el-button>
      </div>
    </template>
  </el-dialog>

  <el-calendar v-model="day" >
    <template #date-cell="{ data }">
      <div @dblclick="setNum(data.day)" class="div-container">
        <div class="flex-centered" :class="{ 'goal-achieved': isGoalAchieved(data.day) }">
          <p>
            {{ data.date.getDate() }}
          </p>
        </div>

        <div class="flex-centered2" :class="{ 'goal-achieved': isGoalAchieved(data.day) }">
          <p>
            {{ dayCount[data.day] || 0 }}
          </p>
        </div>
      </div>


    </template>

  </el-calendar>

</template>

<script lang="ts" setup>
import store from "@/data/Store";
import { computed, ref, watch } from "vue";


import "element-plus/theme-chalk/dark/css-vars.css";
import { Notice } from "obsidian";
import { useI18n } from "vue-i18n";
import dayjs from "dayjs";


// 日期
const day = ref(new Date());
const yearMon = dayjs(day.value).format("YYYY-MM");
store.commit("updateMonth", yearMon);
store.commit("updateDay", dayjs(day.value).format("YYYY-MM-DD"));




let currentMonNow = dayjs(day.value).format("YYYY-MM");

watch(day, (newValue) => {
  // // // console.log("newValue", newValue);
  store.commit("updateDay", dayjs(newValue).format("YYYY-MM-DD"));
  const yearMon = dayjs(newValue).format("YYYY-MM");
  if (currentMonNow != yearMon) {
    store.commit("updateMonth", yearMon);
    currentMonNow = yearMon;
  }
});

const dayCount = computed(() => {
  return store.getters.threeMonthsData || {};
});

const dayPlan = computed(() => {
  return store.getters.threeMonthsDayPlan || {};
});


/**
 * 设置每天的字数
 * @param day
 */
const dialogVisible = ref(false);
const wordCountPerDay = ref(0);

const { t } = useI18n() // t方法取出，t('code')使用

const setNum = (day: string) => {
  // 判断日期，如果时间超过当日，则不能设置
  if (dayjs(day).isAfter(dayjs(), "day")) {
    new Notice(t("modifyWordCountNotice"));
    return;
  }


  dialogVisible.value = true;
  wordCountPerDay.value = dayCount.value[day] || 0;
};

const confirm = () => {
  dialogVisible.value = false;
  // console.info("confirm", wordCountPerDay.value);
  const dayFormat = dayjs(day.value).format("YYYY-MM-DD");
  store.commit("updateDayCounts", { [dayFormat]: wordCountPerDay.value })
    ;
};

// 是否开启计划
const enablePlan = computed(() => {
  return store.getters.enablePlan;
});

const isGoalAchieved = (day: string) => {
  return enablePlan.value && dayPlan.value[day] > 0 && (dayCount.value[day] || 0) > dayPlan.value[day];
};

</script>


<style>
.el-calendar-table .is-selected {
  color: #1989fa;
}

.div-container {
  display: flex;
  /* 启用 Flexbox */
  justify-content: center;
  /* 水平居中 */
  align-items: stretch;
  /* 使子元素垂直方向上填充容器空间 */
  flex-direction: column;
  /* 改变子元素的方向为垂直 */
  height: 100%;
  /* 占满高度 */
}

.flex-centered {
  display: flex;
  /* 启用 Flexbox */
  justify-content: center;
  /* 水平居中 */
  align-items: center;
  /* 垂直居中 */
  height: 40%;
  /* 占满高度，根据需要调整 */
  font-weight: bold;
}

.flex-centered2 {
  display: flex;
  /* 启用 Flexbox */
  justify-content: center;
  /* 水平居中 */
  align-items: center;
  /* 垂直居中 */
  height: 30%;
  /* 占满高度，根据需要调整 */
}

.flex-centered3 {
  display: flex;
  /* 启用 Flexbox */
  justify-content: center;
  /* 水平居中 */
  align-items: center;
  /* 垂直居中 */
  height: 30%;
  /* 占满高度，根据需要调整 */
}


.goals {
  /*让子项居中*/
  display: flex;
  align-items: center;
}

.el-icon {
  margin-left: 6px;
  margin-right: 6px;
}

/* 以下的样式由网友提供
https://github.com/yefengr/obsidian-daily-statistics/issues/7
*/


/* Daily Statistics plugin tweaks */
.el-calendar button:focus,
.el-calendar button:hover,
.el-calendar button {
  background: none;
  border: 0;
  box-shadow: none;
  line-height: .7;
  padding: 0;
}

/* stylelint-disable-next-line */
.el-calendar-day>.div-container>.flex-centered3,
.el-button-group::after,
.el-button-group::before {
  display: none;
}

.el-calendar .el-button-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0 15px;
}

.el-calendar-table .el-calendar-day {
  height: 50px;
}

.el-calendar-day>.div-container>.flex-centered {
  font-weight: 600;
}

.el-calendar__header {
  display: block;
}

/* stylelint-disable-next-line */
.el-calendar__title {
  font-size: 14px;
  margin-bottom: 5px;
}

/* stylelint-disable-next-line */
.el-calendar-day>.div-container p {
  font-size: 12px;
}

.el-calendar-day>.div-container {
  gap: 5px;
}

.goal-achieved {
  color: #67C23A;
  /* Element Plus 的成功绿色 */
}



/* 设置日历背景透明 */
.el-calendar {
  background-color: transparent !important;
}

.daily-statistics-calendar-view .daily-statistics-progress-shell,
.daily-statistics-calendar-view .daily-statistics-progress-shell::before,
.daily-statistics-calendar-view .daily-statistics-progress-shell::after,
.daily-statistics-calendar-view .daily-statistics-progress,
.daily-statistics-calendar-view .daily-statistics-progress::before,
.daily-statistics-calendar-view .daily-statistics-progress::after,
.daily-statistics-calendar-view .daily-statistics-progress .goals,
.daily-statistics-calendar-view .daily-statistics-progress .goals::before,
.daily-statistics-calendar-view .daily-statistics-progress .goals::after,
.daily-statistics-calendar-view .daily-statistics-progress .el-progress,
.daily-statistics-calendar-view .daily-statistics-progress .el-progress::before,
.daily-statistics-calendar-view .daily-statistics-progress .el-progress::after {
  background: var(--background-primary) !important;
  background-color: var(--background-primary) !important;
  background-image: none !important;
  box-shadow: none !important;
}

</style>
