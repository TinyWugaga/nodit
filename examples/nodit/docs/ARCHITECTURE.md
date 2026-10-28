# Architecture

這份文件描述系統的整體架構。Nodit 的 Architecture 頁會渲染它，並把文中的 ADR-001、MS-01、T-001 這類代號連到對應卡片。

## 概觀


## 主要元件

```mermaid
flowchart LR
  UI --> API --> Storage
```

## 專案結構

說明主要資料夾與檔案的用途，讓人知道東西該去哪裡找。下面的 nodit-tree 區塊會顯示在 Architecture 頁的 Structure 分頁：每行寫「路徑、兩個以上空白、說明」，縮排兩格表示子層，資料夾以 / 結尾。

```nodit-tree
src/            …
docs/           ADR、Milestone、Task 卡片與本文件
```

## 相關決策

