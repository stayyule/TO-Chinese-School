# TOCS 中文學校註冊與管理系統重寫 — 需求文件（繁體中文）

- 狀態：**草案，待協同審閱**（Draft for review）
- 對應英文版：[REQUIREMENTS.en.md](REQUIREMENTS.en.md)（章節與 FR/BR/SEC 編號一一對應）
- 簡體中文版：[REQUIREMENTS.zh-CN.md](REQUIREMENTS.zh-CN.md)（內容相同，僅字體與用語不同）
- 待決問題清單：[REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md)
- 本文件**不包含任何實作**，也**不預設技術方案**；技術選型僅在附錄 A 中比較。
- 依據：對現有系統 `chineseschool/`（Rails 3.2.13 + PostgreSQL）的唯讀分析。需求條目末尾的「來源」為現有程式碼路徑，便於審閱者核對。
- 可信度說明：第 4 節業務規則已逐行對照 `student_fee_payment.rb`、`registration_payment.rb`、`school_year.rb`、`withdraw_request*.rb`；第 3 節功能需求主要依據 `config/routes.rb`、控制器／檢視檔案名稱與首頁角色面板推斷，**未逐個頁面核對**，請各角色代表重點審閱。

---

## 1. 目的與範圍

### 1.1 目的
將現有 Rails 3.2 系統改用其他框架重寫，**保持相同的業務邏輯**，並改為前後端分離、可自動化維運、部署在單台 Ubuntu 雲端伺服器。

### 1.2 範圍內
帳號與權限、人員與家庭、學年設定、年級與班級、分班與教師分配、註冊與收費、退課與退費、財務與對帳、期末成績、通訊表單、郵件通知、報表與匯出。

### 1.3 範圍外（明確不重寫）
**田徑比賽（Track Event）功能整體刪除**，包括：

| 類別 | 內容 |
|------|------|
| 路由 | `activity/track_events/*`（報名、組隊、分組、賽道分配、成績輸入與計分、班級得分、TOCS 資料 CSV 等全部 action） |
| 模型 | `TrackEventProgram`、`TrackEventHeat`、`TrackEventSignup`、`TrackEventTeam`、`TrackEventAgeGroup`、`JerseyNumber` |
| 資料表 | `track_event_programs`、`track_event_heats`、`track_event_signups`、`track_event_teams`、`jersey_numbers` |
| 檢視／PDF | `activity/track_events/*`（含 `sign_up.pdf.prawn`、`tocs_lane_assignment_form.pdf.prawn`） |
| 遺留欄位 | `grades` 表中與運動會號碼相關的欄位（如 `jersey_number_prefix`）在新系統中忽略，不遷移語意 |
| 首頁入口 | 首頁角色面板 `_activity_officer` 中與田徑相關的入口 |

> 註：`activity/forms`（消防演習表、班級資訊、按班級學生名單）不屬於田徑功能，依 Q-01 決定**全部保留**（見 FR-COM-03）。
>
> **圖書借閱功能同樣不重寫**（2026-11-02 決定，見 3.7）：路由 `librarian/*`，模型 `LibraryBook`、`LibraryBookCheckout`，資料表 `library_books`、`library_book_checkouts`，圖書檢索結果 PDF 範本，首頁圖書管理員面板，以及圖書管理員角色。

### 1.4 已確認的限制
| 編號 | 限制 |
|------|------|
| C-1 | 沿用現有 PostgreSQL 資料庫與資料表結構（刪除田徑 5 張表和圖書 2 張表後約 29 張表），不做資料遷移 |
| C-2 | 前後端分離：後端提供 REST API，前端為單頁應用程式 |
| C-3 | 目標環境為**單台 Ubuntu 雲端伺服器**，應用程式與資料庫同機 |
| C-4 | 需要自動化維運（容器化、CI/CD、自動遷移、監控、備份） |

---

## 2. 角色與權限

現有系統首頁依角色呈現面板（`app/views/home/_*.html.erb`），角色包括：

| 角色 | 說明 |
|------|------|
| 學生家長（Student Parent） | 維護家庭與孩子資訊、註冊、繳費、退課、查看交易 |
| 教師（Instructor） | 查看所教班級、輸入期末成績；角色由當年任課分配自動推導 |
| 班級家長（Room Parent） | 同上，由任課分配（role）推導 |
| 註冊官（Registration Officer） | 人員／家庭、分班、教師分配、註冊報表 |
| 會計官（Accounting Officer） | 現場繳費、手動交易、收款報表、教師折扣 |
| 教務官／教務副校長（Instruction Officer / Academic Vice Principal） | 教學與班級相關查看與報表 |
| 校長（Principal） | 管理與查看 |
| PVA | 家長會相關（接收退課通知等） |
| 通訊官（Communication Officer） | 拍照同意書、年鑑學生名單 |
| 活動官（Activity Officer） | 表單類功能（田徑已刪除；表單類依 Q-01 保留） |
| 系統管理員 | 學年、年級、班級、角色／權限、邀請註冊 |

- **FR-AUTH-05**：權限為「角色 → 權限碼」模型，伺服器端對每個介面強制檢查；一個使用者可擁有多個角色。
  - 來源：`app/models/user.rb#authorized?`、`right.rb`、`role.rb`
- **FR-AUTH-06**：管理員可查看權限、查看角色詳情、為使用者新增／移除角色。
  - 來源：`admin/rights`、`admin/roles`（`add_user`、`remove_user`）
- **FR-AUTH-07**：教師、班級家長角色須隨當年任課分配自動增刪（`adjust_instructor_roles`）。
  - 來源：`app/models/user.rb#adjust_instructor_roles`

---

## 3. 功能需求

優先順序：**M**=必須，**S**=應該，**C**=可選。驗收標準寫成「給定／當／則」。

### 3.1 帳號與登入（AUTH）

| 編號 | 需求 | 優先順序 | 驗收標準 |
|------|------|--------|----------|
| FR-AUTH-01 | 使用者名稱＋密碼登入；登入後跳回原請求頁面 | M | 未登入存取受保護頁面→跳至登入→成功後回到原頁面 |
| FR-AUTH-02 | 登出，使工作階段失效 | M | 登出後再存取受保護介面回傳未驗證 |
| FR-AUTH-03 | 管理員透過郵件邀請人員註冊帳號（邀請連結含有時效權杖） | M | 過期／已使用的權杖被拒絕 |
| FR-AUTH-04 | 忘記密碼：寄送帶時效權杖的重設郵件；已登入使用者可修改密碼 | M | 權杖僅單次有效、限時 |
| FR-AUTH-08 | 公開頁面：聯絡我們、隱私聲明、同意書範例 | S | 無需登入即可存取 |
| FR-AUTH-09 | 新家長自助註冊：填寫地址、家長一資訊、使用者名稱和密碼，一次建立地址、人員、家庭、帳號（Student Parent 角色）；地址的電子郵件已存在則拒絕 | M | 全部成功或全部不建立；電子郵件已被登記時回傳衝突且不顯示既有使用者名稱；同一使用者名稱並行註冊只成功一個（2026-11-02 補充，舊程式碼 `signin#register`） |
| FR-AUTH-10 | 找回使用者名稱：依電子郵件把使用者名稱寄送到該信箱 | S | 無論電子郵件是否存在回應皆相同，頁面不顯示使用者名稱（2026-11-02 補充，舊程式碼 `signin#forgot_username`；舊版直接在頁面顯示使用者名稱，新版改為郵件寄送） |

> FR-AUTH-03/04 補充：邀請註冊與重設密碼在提交時須核對電話號碼（與人員或其家庭地址上的住家／手機號碼一致，僅比較數字），作為身分驗證；忘記密碼對不存在的使用者名稱／無電子郵件的使用者回應相同。來源：`signin_controller`、`person.rb#phone_number_correct?`。

來源：`signin_controller`、`signout_controller`、`timed_token.rb`、`signin_mailer`、`pages_controller`、`home/change_password`

### 3.2 學生家長（STU）

| 編號 | 需求 | 優先順序 | 驗收標準 |
|------|------|--------|----------|
| FR-STU-01 | 維護自己的家庭、家長與孩子資訊、地址 | M | 家長只能讀寫自己家庭的資料 |
| FR-STU-02 | 選擇註冊偏好（年級／班級偏好、選修課、是否僅註冊選修課） | M | 偏好按學年儲存 |
| FR-STU-03 | 查看費用明細並以信用卡線上繳費 | M | 金額與 BR 規則一致；成功後產生交易記錄與收據郵件 |
| FR-STU-04 | 申請現場繳費（稍後由會計官輸入） | M | 產生「待現場繳費」記錄，會計官可見 |
| FR-STU-05 | 刪除未付款的待處理註冊付款 | S | 僅限本人、未付款 |
| FR-STU-06 | 繳費確認頁 | M | 顯示已繳金額、學生、交易編號 |
| FR-STU-07 | 提出退課申請（可選「僅退選修課」）；可取消未處理的申請 | M | 產生待審核請求；僅本人可見／取消 |
| FR-STU-08 | 查看交易歷史（本人已付款） | M | 依時間倒序 |
| FR-STU-09 | 首頁顯示當前學年班級分配 | S | 顯示學生、年級班級、選修班 |

來源：`student/registration_controller`、`student/withdraw_controller`、`student/transaction_history_controller`、`student/families_controller`、`student/people_controller`、`home/_student_parent`

### 3.3 註冊官（REG）

| 編號 | 需求 | 優先順序 | 驗收標準 |
|------|------|--------|----------|
| FR-REG-01 | 查詢／查看／新增人員與家庭 | M | 支援依姓名檢索 |
| FR-REG-02 | 為學生選擇／調整年級、班級、選修班 | M | 變更儲存到當年 `student_class_assignments` |
| FR-REG-03 | 教師任課分配：選擇班級、開始／結束日期、角色；刪除分配 | M | 儲存後自動調整教師／班級家長角色 |
| FR-REG-04 | 自動／隨機分配年級班（受學年開關 `auto_class_assignment` 控制） | S | 開關關閉時不自動分班 |
| FR-REG-05 | 班級統計：各年級班／選修班／年級學生人數 | M | 只統計當年已分班學生 |
| FR-REG-06 | 報表：註冊完整性檢查、同年級兄弟姊妹 | S | 輸出與舊系統在同一份資料上一致 |
| FR-REG-07 | 名單：依姓名的在學學生名單、依班級學生名單（PDF） | M | 中文姓名正常顯示 |

來源：`registration/*`

### 3.4 會計官（ACC）

| 編號 | 需求 | 優先順序 | 驗收標準 |
|------|------|--------|----------|
| FR-ACC-01 | 查看待現場繳費清單並輸入現場付款 | M | 輸入後標記已付款並觸發分班與收據 |
| FR-ACC-02 | 手動交易：新增、列表、查看 | M | 記錄金額、原因、操作人 |
| FR-ACC-03 | 註冊收款報表：依日期；費用收取彙總 | M | 日期邊界以太平洋時間計 |
| FR-ACC-04 | 教師折扣查看／設定 | S | 與 BR-FEE-08 一致 |

來源：`accounting/*`

### 3.5 管理員（ADM）

| 編號 | 需求 | 優先順序 | 驗收標準 |
|------|------|--------|----------|
| FR-ADM-01 | 學年管理：新增／編輯／查看，含費用與日期設定；切換自動分班開關；編輯書本費 | M | 見 BR 中所有 `school_years` 欄位；`previous_school_year` 自動關聯 |
| FR-ADM-02 | 年級管理 | M | — |
| FR-ADM-03 | 班級管理：新增、編輯、啟用／停用（按學年） | M | 未啟用班級不出現在分班選項 |
| FR-ADM-04 | 員工分配（staff assignments） | M | 決定員工折扣資格 |
| FR-ADM-05 | 退課請求處理：列表、核准／拒絕 | M | 核准後依 BR-REF 處理副作用 |
| FR-ADM-06 | 邀請註冊（見 FR-AUTH-03） | M | — |

來源：`admin/*`

### 3.6 教學（INS）

| 編號 | 需求 | 優先順序 | 驗收標準 |
|------|------|--------|----------|
| FR-INS-01 | 教師查看自己當年所教班級與學生名單 | M | 僅限本人任課班級 |
| FR-INS-02 | 輸入／查看期末成績；下載成績；查看往年成績 | M | 輸入期間自 `end_date` 所在年 5 月 1 日起 |
| FR-INS-03 | 教務角色查看所有啟用班級 | S | — |

來源：`instruction/*`，`school_year.rb#start_date_for_entering_student_final_mark`

### 3.7 圖書（LIB）— 已刪除（範圍外）

2026-11-02 決定：圖書借閱功能整體不重寫，原 FR-LIB-01（圖書列表／新增／唯讀檢視）、FR-LIB-02（借還記錄）、FR-LIB-03（依學生檢索並匯出 PDF）全部取消。保留 3.7 編號以避免後續章節與審閱清單的編號變動。

來源（僅供核對）：`librarian/*`、`library_books`、`library_book_checkouts`

### 3.8 通訊與表單（COM）

| 編號 | 需求 | 優先順序 | 驗收標準 |
|------|------|--------|----------|
| FR-COM-01 | 拍照同意書（PDF） | S | — |
| FR-COM-02 | 年鑑學生名單 | S | — |
| FR-COM-03 | 消防演習表、班級資訊、依班級學生名單（`activity/forms`） | S | Q-01 已決：保留；含學生個人資訊的名單每次匯出寫入稽核日誌 |

來源：`communication/forms_controller`、`activity/forms_controller`

### 3.9 郵件通知（MAIL）

| 編號 | 郵件 | 觸發 |
|------|------|------|
| FR-MAIL-01 | 帳號邀請／忘記密碼 | 邀請、找回密碼 |
| FR-MAIL-02 | 付款確認（收據） | 付款成功 |
| FR-MAIL-03 | 教材通知、註冊員通知 | 付款成功且距開學≤1天；註冊員通知僅在開學日之後 |
| FR-MAIL-04 | 信用卡交易錯誤告警（維運） | 金流閘道異常 |
| FR-MAIL-05 | 退課通知：任課教師、家長、註冊員、會計、PVA | 退課核准；教師通知僅在距開學≤1天 |

來源：`app/mailers/*`、`app/views/*_mailer/*`

---

## 4. 業務規則（可測試）

> 所有金額為**整數分**（`*_in_cents`）。所有「今天」均指**太平洋時間**日期（`PacificDate.today`）。

### 4.1 學費與費用（BR-FEE）— 來源 `student_fee_payment.rb`

每個學生的費用 = 註冊費 + 學費 + 書本費 + 選修課費。

- **BR-FEE-01 註冊費**：等於當年 `registration_fee_in_cents`。
- **BR-FEE-02 選修課費**：未選選修課為 0；否則為當年 `elective_class_fee_in_cents`。
- **BR-FEE-03 書本費**：由 `BookCharge` 依學年與年級決定。
- **BR-FEE-04 基礎學費**：若今天 ≤ `early_registration_end_date` 且 `early_registration_tuition_in_cents > 0`，使用早鳥學費並標記 `early_registration`；否則使用 `tuition_in_cents`。
- **BR-FEE-05 親子班費**：班級類型為「日常中文親子班」時，學費加上親子班費（今天 ≤ 早鳥截止日用早鳥親子班費，否則用標準親子班費）。
- **BR-FEE-06 Pre-K 折扣**：年級為學前班且 `tuition_discount_for_pre_k_in_cents > 0` 時，學費減該折扣並標記 `pre_k_discount`。
- **BR-FEE-07 多子女折扣**：本次付款／已付款／待付款中，此學生之前已有 ≥ 2 名學生（即第 3 個及以後）且折扣 > 0，學費減 `tuition_discount_for_three_or_more_child_in_cents`。
- **BR-FEE-08 員工與教師折扣**（在遲報折算之後執行）：
  - 若學生所屬家庭當年有員工：僅當已付款與待付款的費用明細中**尚無**員工折扣時，學費設為 0 並標記 `staff_discount`（即員工折扣只享受一次）；
  - 若無員工而有教師：教師折扣最多套用於 **2 名**學生，學費減 `tuition_discount_for_instructor_in_cents`（該值 > 0 才生效）；
  - 家庭既有員工又有教師時，僅適用員工折扣。
- **BR-FEE-09 遲報折算**：今天 > `registration_75_percent_date` 時，學費 = `trunc(學費 × 0.75)`，標記 `prorate_75`。（自 2017-18 學年起 50% 折算日期不再使用。）
- **BR-FEE-10 套用順序**：基礎學費 → 親子班費 → Pre-K 折扣 → 多子女折扣 → 遲報折算 → 員工／教師折扣。
- **BR-FEE-11 捨入**：所有折算使用**截斷取整**（`.to_i`），新系統必須複製。

> 決定（Q-10 已決，2026-11-02）：**忠實複製**上述順序。該順序只影響「遲報的教師家庭」：教師折扣在折算之後才減，不被打 75% 折。範例（數字為假設）：學費 600、教師折扣 100 → 現況 600×0.75−100=350；若先減折扣則 (600−100)×0.75=375。黃金案例須專門涵蓋「遲報＋教師折扣」，並標註為已知且刻意保留的行為。
>
> 邊界：教師折扣與 Pre-K 折扣均為直接相減、無下限，折扣大於學費時學費為負。預設複製，並以黃金案例固定該行為；若業務方認為不應出現負學費，再另行修改。會計官對「遲報教師折扣不打折」的確認仍待定。

### 4.2 會費與合計（BR-PAY）— 來源 `registration_payment.rb`

- **BR-PAY-01 PVA 會費**：該家庭本學年已完成註冊數 > 0 時為 0；否則為 `pva_membership_due_in_cents`（每家庭一次；2024/04 起與 CCCA 相同規則）。
- **BR-PAY-02 CCCA 會費**：已完成註冊數 > 0 → 0；付款人所屬任一家庭為 CCCA 終身會員 → 0；否則為 `ccca_membership_due_in_cents`。
- **BR-PAY-03 合計**：`grand_total = pva + ccca + Σ(每名學生 total)`。
- **BR-PAY-04 付款後動作**：建立學生班級分配；寄送收據；條件滿足時寄送教材通知與註冊員通知（見 FR-MAIL-03）。
- **BR-PAY-05 分類查詢**：已付款／待付款／待現場繳費；「某日收款」依太平洋日界線換算 UTC。

### 4.3 退課與退費（BR-REF）— 來源 `school_year.rb`、`withdraw_request*.rb`

- **BR-REF-01 學費退款比例**（Q-11 已決，依序判斷，先命中先用）：
  1. 學校尚未開學 → 100%；
  2. 今天 > `refund_end_date` → **0（不可退）**；
  3. 今天 > `refund_50_percent_date` → 50%；
  4. 今天 > `refund_90_percent_date` → 90%；
  5. 否則 100%。
  （舊欄位 `refund_25_percent_date`、`refund_75_percent_date` 已不再使用，新系統不實作其分支。第 2 步是依意圖修正：舊程式碼該分支恆為假，見下方決定。比例退款用整數運算，取整方式待黃金案例實測後確定。）
- **BR-REF-02 PVA/CCCA 退款**（Q-11 已決，更正）：兩項會費均按家庭收取。僅當學校尚未開學、且該家庭退課後已無在學學生時，全額退還該家庭最早一筆已付款中的 PVA 和 CCCA；退課後仍有 1 名或以上學生，或學校已開學，均不退。（2024/4/14 起；舊程式碼按比例退 PVA 的函式已是死碼，不再實作。）
- **BR-REF-02a 不退項目**：註冊費不退；書本費僅在學校尚未開學時退；選修課費（整班退或僅退選修課）按全額退，不受日期影響。
- **BR-REF-03 退款合計**：`refund_pva + refund_ccca + Σ(明細：註冊費+書本費+學費+選修課費)`。
- **BR-REF-04 副作用（同一交易）**：為每個學生產生 `WithdrawalRecord`（記錄註冊日期、退課日期、原年級／班級／選修班）；若非「僅退選修課」則將學生狀態設為未註冊並刪除班級分配；若「僅退選修課」則保留班級分配，僅將選修班設為 0，並清空註冊偏好中的選修班；距開學 ≤ 1 天時通知相關教師。
- **BR-REF-05 狀態**：待審核 P、已核准 A、已拒絕 D、已取消 C。

> 決定（Q-11 已決，2026-11-02）：
> 1. 舊程式碼 `refund_end_date` 判斷寫成 `!self.refund_end_date && today > refund_end_date`：日期存在時恆為假，截止日之後仍會按比例退款；日期為空時會拋出例外。但家長端用 `refund_end_date >= 今天` 決定是否顯示退課入口，且退款在提交申請時計算，所以正常使用中截止日後無法提交。新系統**依意圖修正為 0**，並在伺服器端提交和核准時都驗證該日期，不依賴介面隱藏入口。
> 2. 只有 50%/90% 兩個檔位有效，舊的 25%/75% 欄位不再實作。
> 3. 黃金案例同時記錄舊系統實際輸出與新系統修正後輸出：非截止日案例兩者必須一致；截止日之後新系統為 0。

### 4.4 其他規則（BR-MISC）

- **BR-MISC-01 學年**：`current_school_year` = 結束日期 ≥ 今天的最早學年；`next_school_year` 為其後一個；註冊開放學年 = 早鳥開始 ≤ 今天 ≤ 註冊結束；退款開放學年 = 退款截止 ≥ 今天。
- **BR-MISC-02 學年驗證**：開始日期不得晚於結束日期；多數費用欄位須為正整數（折扣欄位可為 0）。
- **BR-MISC-03 年齡截止月**：學年設定 `age_cutoff_month` 用於判定學生年級／年齡資格。
- **BR-MISC-04 成績輸入期間**：自結束年份 5 月 1 日起開放。

---

## 5. 資料需求

- 沿用現有 PostgreSQL 資料表結構（C-1）。保留的核心表：
  `addresses`、`book_charges`、`families`、`families_children`、`gateway_transactions`、`grades`、`in_person_registration_transactions`、`instructor_assignments`、`manual_transactions`、`people`、`registration_payments`、`registration_preferences`、`rights`、`rights_roles`、`roles`、`roles_users`、`school_class_active_flags`、`school_classes`、`school_years`、`staff_assignments`、`student_class_assignments`、`student_fee_payments`、`student_final_marks`、`student_status_flags`、`timed_tokens`、`users`、`withdraw_request_details`、`withdraw_requests`、`withdrawal_records`。
- 刪除（範圍外）：`track_event_heats`、`track_event_programs`、`track_event_signups`、`track_event_teams`、`jersey_numbers`。（Q-12 已決，2026-11-02）新系統**不遷移**這些表，不納入資料模型，不得讀寫。它們在正式環境資料庫中**保留不動**（不讀不寫，不遷移這部分資料）。
- 刪除（範圍外，2026-11-02）：`library_books`、`library_book_checkouts`（圖書借閱功能不重寫）。處理方式與田徑表相同：新系統不納入資料模型、不得讀寫，正式環境資料庫中保留不動，不遷移這部分資料。
- **DATA-01 無 id 關聯表**：`families_children(family_id, child_id)`、`rights_roles`、`roles_users`。
- **DATA-02 非常規外鍵**：`families.parent_one_id/parent_two_id`；`registration_payments.paid_by_id`、`withdraw_requests.request_by_id/status_by_id` 等指向 `people`。
- **DATA-03 金額**：全部 `*_in_cents` 整數；新系統不得使用浮點數儲存或計算金額。
- **DATA-04 使用者表密碼欄位**：`password_hash`（`SHA256(password+salt)` 十六進位）、`password_salt`。（Q-08 已決）新增 `password_hash_v2` 存 argon2id 字串；舊兩欄保留到升級截止日後清空並刪除。
- **DATA-05 現有資料庫以 `db/schema.rb` 為準**，遷移檔不完整（最早 2014 年）；審閱前需取得去識別化的正式環境資料庫結構副本核對。

---

## 6. 外部整合

| 編號 | 整合 | 現況 | 需求 |
|------|------|------|------|
| INT-01 | 支付閘道 | ActiveMerchant → Authorize.net（`AUTHORIZE_NET_GATEWAY` 常數不在儲存庫，憑證在伺服器上）；卡號不落地儲存，僅存類型／末四碼 | 保留功能（Q-02 已決）：繼續使用 Authorize.net；改為嵌入式代碼化（tokenization），卡號由瀏覽器直接送給閘道換取權杖，後端只用權杖扣款；支付封裝在介面後；憑證改用環境變數；見 SEC-05 |
| INT-02 | 郵件 | SMTP；共 4 個 Mailer、10 個範本 | 保留（Q-07 已決）：交易型郵件服務（優先 Postmark，或 Amazon SES），經標準 SMTP 對接；寄件網域 `to-cs.org`，沿用現有寄件地址；SPF/DKIM/DMARC 見 SEC-15 |
| INT-03 | PDF | 7 個 Prawn 範本，其中 2 個屬田徑（刪除）、1 個圖書檢索結果（刪除）；保留：班級名單×2、拍照同意書、消防演習表（Q-01 已決：保留，共 4 個） | 保留，含中文字型 |
| INT-04 | CSV | 控制器內嵌產生（成績下載、班級資訊、學生名單等） | 保留 |
| INT-05 | `data-export/` 腳本 | 獨立 Sequel + MySQL 腳本，需手動修改學年 id 與憑證 | （Q-09 已決）13 個腳本全部遷為後端「報表匯出」模組，輸出 CSV；學年為頁面參數；每個報表有明確的權限碼；每次匯出寫入稽核日誌；田徑腳本隨功能刪除。核心功能先做，報表後一期 |

---

## 7. 非功能需求

- **NFR-01 中文**：PDF 與頁面完整支援中文（現有內建 Arial Unicode 字型）。
- **NFR-02 時區**：所有業務日期規則依太平洋時間；測試可凍結時間。
- **NFR-03 規模**（Q-03 已決，2026-11-02）：每學年 300–1000 個家庭（約 450–1500 名學生）；註冊集中在早鳥截止日前後。單機 2 vCPU / 4GB / 40GB+，依同時上線 150 人、付款約 20 筆／分鐘設計，留約 3 倍餘裕。付款提交必須冪等；費用計算、付款記錄與分班在同一資料庫交易內完成。驗收：早鳥截止前壓力測試 150 位並行家長走完整流程（沙箱支付）。假設值待用正式環境資料庫真實資料校正。
- **NFR-04 可用性**（Q-04 已決，2026-11-02）：單機為單點故障。平時 RPO ≤ 24h；註冊開放期 RPO ≤ 1h；RTO ≤ 4h。早鳥截止日前後是否需要熱備機待業務方確認。
- **NFR-05 稽核**：登入失敗、角色／權限變更、退款核准、手動交易、匯出個人資訊必須留稽核日誌。
- **NFR-06 可測試性**：BR 規則須有自動化單元測試，涵蓋日期邊界與捨入。
- **NFR-07 可維護性**：新增介面須明確宣告權限碼，預設拒絕。

---

## 8. 部署與維運需求（單台 Ubuntu 雲端伺服器）

- **OPS-01 拓撲**：同機執行 反向代理（終止 TLS）→ 後端服務 + 前端靜態檔案 + PostgreSQL；用 Docker Compose 或 systemd 編排。PostgreSQL 僅監聽本機／容器內網。
- **OPS-02 CI/CD**：提交觸發 lint → 測試（含真實 PostgreSQL）→ 建置映像檔 → 部署；正式環境部署需人工核准。
- **OPS-03 遷移**：部署時先自動備份，再自動執行資料庫遷移；失敗自動回復到上一版映像檔。
- **OPS-04 設定與密鑰**：全部使用環境變數／受限權限檔案（600），不入版本庫。
- **OPS-05 監控**：`/healthz`、結構化日誌、CPU／記憶體／磁碟／憑證到期告警、錯誤回報；支付失敗與郵件失敗告警。
- **OPS-06 備份**（Q-04 已決）：平時每日加密 `pg_dump`；註冊開放期優先啟用 WAL 歸檔（否則每小時備份）。備份上傳前加密，金鑰不存放在伺服器上，異地保存於另一雲端廠商帳號下的物件儲存。保留：日備份 30 天、月備份 12 個月。每學年註冊開放前至少做一次還原演練。
- **OPS-07 單機限制**：無高可用性；需要可依腳本在新機器上快速重建（基礎設施即程式碼）。

---

## 9. 安全需求與建議

### 9.1 基於現有程式碼發現的問題（新系統必須消除）

| 編號 | 現況問題 | 建議 |
|------|----------|------|
| SEC-01 | `routes.rb` 末尾遺留萬用路由 `match ':controller(/:action(/:id))'`，使每個控制器 action 都可透過 GET 存取，擴大攻擊面且繞過 CSRF | 僅公開明確宣告的介面，預設拒絕；寫入操作只用 POST/PUT/DELETE |
| SEC-02 | 密碼為 `SHA256(password+6位元組鹽)`，抗暴力破解能力弱；最小長度 6 | 採用 argon2id（或 bcrypt）；提高最小長度；登入限速與鎖定；舊雜湊在首次登入成功後升級（Q-08） |
| SEC-03 | 權限用 Rails `controller/action` 字串比對 | 使用明確的權限碼；每個介面做**物件層級**授權（家長只能存取自己的家庭／孩子，防 IDOR） |
| SEC-04 | `sibling_in_same_grade` 使用字串串接 SQL | 全部參數化查詢；禁止串接 |
| SEC-05 | 支付：`AUTHORIZE_NET_GATEWAY` 憑證存放位置不明 | 卡號絕不落地儲存、不寫入日誌；**卡號不得經過我們的伺服器**（Q-02 已決：嵌入式代碼化，瀏覽器直接向閘道換取權杖）；憑證放伺服器環境變數並定期輪替；開發／測試只用沙箱帳號；對應的 PCI 自評問卷等級在設計階段對照官方文件確認 |
| SEC-06 | 工作階段使用 Rails cookie；`TimedToken` 為明文權杖 | Cookie 設 HttpOnly、Secure、SameSite；CSRF 防護；重設／邀請權杖一次性、短時效、**僅存雜湊** |
| SEC-07 | `lib/key/`（gitignore）與 `database.yml` 含寫死的使用者名稱 | 儲存庫不含任何密鑰；CI 中啟用 secret 掃描 |
| SEC-08 | 含大量未成年人及家長個人資訊（姓名、電話、地址） | 最小化欄位、依角色遮蔽、匯出（CSV/PDF）寫入稽核日誌、明確保留期限與刪除流程 |

### 9.2 Ubuntu 主機強化

- **SEC-10 網路**：僅開放 80/443 與 SSH（UFW + 雲端安全群組雙層）；SSH 僅金鑰登入、禁用 root 與密碼登入、限制來源 IP、啟用 Fail2ban。
- **SEC-11 系統**：啟用 unattended-upgrades 自動安全更新；最小化安裝；關閉不用的服務。
- **SEC-12 容器**：非 root 執行、唯讀根檔案系統、捨棄多餘 capabilities；不公開 Docker 常駐程式連接埠。
- **SEC-13 資料庫**：僅本機監聽；應用程式使用最小權限專用帳號（非超級使用者）；`scram-sha-256`；備份加密；磁碟加密（雲端磁碟加密）。
- **SEC-14 TLS**：Let's Encrypt 自動續期；HSTS；停用舊協定；安全回應標頭（CSP、X-Frame-Options、X-Content-Type-Options、Referrer-Policy）。
- **SEC-15 郵件**（Q-07 已決）：為 `to-cs.org` 設定 SPF、DKIM、DMARC。新的寄送服務須**合併**進現有 SPF 記錄，不得新建第二筆；DMARC 先 `p=none` 觀察 1–2 週，再升至 `quarantine`。退信率、投訴率與寄送失敗須告警。
- **SEC-16 供應鏈**：相依套件與映像檔弱點掃描（CI），鎖定版本；及時升級。
- **SEC-17 日誌與稽核**：日誌集中保存、限制存取、去識別化（不記錄卡號／密碼／權杖）；保留期限明確。
- **SEC-18 單機風險**：應用程式與資料庫同機意味著應用程式被攻破可能波及資料庫——資料庫帳號最小權限、網路隔離（容器內網）、異地加密備份是關鍵補償措施。

---

## 10. 遷移與驗證策略

- **MIG-01 密碼相容**（Q-08 已決，2026-11-02）：新系統需能驗證舊 `SHA256(password+salt)`，舊密碼登入成功時靜默升級為 argon2id（只換雜湊，不改密碼）。上線後 6 個月為截止日（避開註冊高峰），到期仍為舊雜湊的帳號作廢舊雜湊並經郵件重設。新密碼規則（最短 10 位）僅在修改／重設密碼時生效。登入限速與失敗鎖定須在上線前完成；登入失敗、重設、雜湊升級寫入稽核日誌。
- **MIG-02 權限對應**：建立舊 (controller, action) → 新權限碼的對應表，逐條斷言角色可存取性與舊系統一致。
- **MIG-03 金額黃金案例**：由舊系統對固定輸入（含日期邊界、多子女、員工／教師、遲報、親子班）產出學費／會費／退款金額表，作為新系統必須通過的案例。
- **MIG-04 並行驗證**（Q-05 已決，2026-11-02）：新系統只連接正式環境資料庫的**去識別化副本**，比對人員／班級／交易彙總報表與舊系統輸出；新舊系統不共用正式環境資料庫。
- **MIG-06 切換**（Q-05 已決）：驗證通過後，在離峰期（兩次註冊期之間，避開早鳥截止日）停止舊系統、做最終備份，由新系統一次性接管舊資料庫；任何時刻只有一個系統寫入資料庫。
- **MIG-05 田徑資料**（Q-12 已決）：不遷移，新系統資料模型不含這 5 張表，`grades.jersey_number_prefix` 欄位同樣忽略。這 5 張表以及圖書 2 張表（共 7 張）在正式環境資料庫中保留不動、不遷移：應用程式帳號不授予其權限，Prisma baseline 排除它們，遷移工具不得自動 `DROP`。

---

## 附錄 A：技術方案比較（不做決定，供審閱）

| 面向 | Django + DRF | NestJS (TypeScript) |
|------|--------------|---------------------|
| 從現有資料庫產生模型 | `inspectdb` | Prisma `db pull` |
| 遷移 | Django migrations（對舊資料庫需 `managed=False` 起步） | Prisma Migrate（需 baseline） |
| 管理後台 | 內建 admin，可取代部分管理頁面 | 無，需自建 |
| 權限 | DRF permission classes | Guard／裝飾器 |
| 背景工作 | Celery + Redis（或更輕量的 django-q） | BullMQ + Redis |
| PDF（中文） | ReportLab / WeasyPrint | pdfmake / Puppeteer |
| 測試 | pytest-django、freezegun | Jest、fake timers |
| 語言共用 | 前後端不同語言 | 與前端共用 TypeScript，可共用型別／OpenAPI |
| 單機資源 | 記憶體用量中等；Celery/Redis 為額外程序 | 記憶體用量中等；Redis 同樣額外 |

| 面向 | React | Vue 3 |
|------|-------|-------|
| 建置 | Vite + TypeScript | Vite + TypeScript |
| 路由／狀態／請求 | React Router、TanStack Query、Zustand | Vue Router、TanStack Query(Vue)、Pinia |
| UI 套件 | MUI 或 Ant Design | Element Plus 或 Ant Design Vue |
| 生態／人才 | 最大 | 較大，上手快 |
| 與 ERB 的相似度 | 低（JSX） | 較高（範本語法） |

> 單機部署下兩種後端差異不大；選型主要取決於團隊技能與是否需要內建管理後台。**此表僅供審閱，不代表決定。**
>
> **更新（2026-11-02，Q-06 已決）**：後端 NestJS + Prisma，前端 React（Vite + TypeScript）。上表保留作為決策依據。

## 附錄 B：術語表（中英對照）

| 中文 | English | 說明 |
|------|---------|------|
| 學年 | School Year | 系統核心設定物件，含費用與日期 |
| 家庭 | Family | 家長（最多兩位）與孩子的集合 |
| 人員 | Person | 學生、家長、教師等 |
| 年級／班級 | Grade / School Class | 年級班與選修班 |
| 選修班 | Elective Class | 額外收費 |
| 分班 | Class Assignment | 學生與班級的年度關係 |
| 教師任課分配 | Instructor Assignment | 含角色與起訖日期 |
| 班級家長 | Room Parent | 由任課分配的角色推導 |
| 員工分配 | Staff Assignment | 決定員工折扣 |
| 註冊付款 | Registration Payment | 一次家庭繳費，含多名學生 |
| 學生費用明細 | Student Fee Payment | 每名學生的註冊費／學費／書費／選修費 |
| PVA | PVA | 會費之一；只使用縮寫，不需要全名（Q-13 已決） |
| CCCA | CCCA | 會費之一，含「終身會員」免收；只使用縮寫，不需要全名（Q-13 已決） |
| 早鳥 | Early Registration | 早鳥學費與截止日 |
| 遲報折算 | Late Registration Prorate | 75% 折算 |
| 多子女折扣 | Multiple-Child Discount | 第 3 名及以後學生 |
| 退課 | Withdraw | 退課申請與退費 |
| 期末成績 | Student Final Mark | 教師於 5 月起輸入 |
| 太平洋時間 | Pacific Time | 所有業務日期基準 |
