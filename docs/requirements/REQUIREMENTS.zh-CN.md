# TOCS 中文学校注册与管理系统重写 — 需求文档（中文）

- 状态：**草案，待协同审阅**（Draft for review）
- 对应英文版：[REQUIREMENTS.en.md](REQUIREMENTS.en.md)（章节与 FR/BR/SEC 编号一一对应）
- 待决问题清单：[REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md)
- 本文档**不包含任何实现**，也**不预设技术方案**；技术选型仅在附录 A 中对比。
- 依据：对现有系统 `chineseschool/`（Rails 3.2.13 + PostgreSQL）的只读分析。需求条目末尾的“来源”为现有代码路径，便于审阅者核对。
- 可信度说明：第 4 节业务规则已逐行对照 `student_fee_payment.rb`、`registration_payment.rb`、`school_year.rb`、`withdraw_request*.rb`；第 3 节功能需求主要依据 `config/routes.rb`、控制器/视图文件名与首页角色面板推断，**未逐个页面核对**，请各角色代表重点审阅。

---

## 1. 目的与范围

### 1.1 目的
将现有 Rails 3.2 系统用其他框架重写，**保持相同的业务逻辑**，并改为前后端分离、可自动化运维、部署在单台 Ubuntu 云服务器。

### 1.2 范围内
账号与权限、人员与家庭、学年配置、年级与班级、分班与教师分配、注册与收费、退课与退费、财务与对账、期末成绩、图书借阅、通信表格、邮件通知、报表与导出。

### 1.3 范围外（明确不重写）
**田径比赛（Track Event）功能整体删除**，包括：

| 类别 | 内容 |
|------|------|
| 路由 | `activity/track_events/*`（报名、组队、分组、赛道分配、成绩录入与计分、班级得分、TOCS 数据 CSV 等全部 action） |
| 模型 | `TrackEventProgram`、`TrackEventHeat`、`TrackEventSignup`、`TrackEventTeam`、`TrackEventAgeGroup`、`JerseyNumber` |
| 数据表 | `track_event_programs`、`track_event_heats`、`track_event_signups`、`track_event_teams`、`jersey_numbers` |
| 视图/PDF | `activity/track_events/*`（含 `sign_up.pdf.prawn`、`tocs_lane_assignment_form.pdf.prawn`） |
| 遗留列 | `grades` 表中与运动会号码相关的列（如 `jersey_number_prefix`）在新系统中忽略，不迁移语义 |
| 首页入口 | 首页角色面板 `_activity_officer` 中与田径相关的入口 |

> 注：`activity/forms`（消防演习表、班级信息、按班级学生名单）不属于田径功能，按 Q-01 决定**全部保留**（见 FR-COM-03）。

### 1.4 已确认的约束
| 编号 | 约束 |
|------|------|
| C-1 | 沿用现有 PostgreSQL 数据库与表结构（删除田径相关 5 张表后约 31 张表），不做数据迁移 |
| C-2 | 前后端分离：后端提供 REST API，前端为单页应用 |
| C-3 | 目标环境为**单台 Ubuntu 云服务器**，应用与数据库同机 |
| C-4 | 需要自动化运维（容器化、CI/CD、自动迁移、监控、备份） |

---

## 2. 角色与权限

现有系统首页按角色渲染面板（`app/views/home/_*.html.erb`），角色包括：

| 角色 | 说明 |
|------|------|
| 学生家长（Student Parent） | 维护家庭与孩子信息、注册、缴费、退课、查看交易 |
| 教师（Instructor） | 查看所教班级、录入期末成绩；角色由当年任课分配自动推导 |
| 班级家长（Room Parent） | 同上，由任课分配（role）推导 |
| 注册官（Registration Officer） | 人员/家庭、分班、教师分配、注册报表 |
| 会计官（Accounting Officer） | 现场缴费、手工交易、收款报表、教师折扣 |
| 教务官/教务副校长（Instruction Officer / Academic Vice Principal） | 教学与班级相关查看与报表 |
| 校长（Principal） | 管理与查看 |
| PVA | 家长会相关（接收退课通知等） |
| 通信官（Communication Officer） | 拍照同意书、年鉴学生名单 |
| 活动官（Activity Officer） | 表格类功能（田径已删除；表格类按 Q-01 保留） |
| 图书管理员（Librarian） | 图书与借阅 |
| 系统管理员 | 学年、年级、班级、角色/权限、邀请注册 |

- **FR-AUTH-05**：权限为“角色 → 权限码”模型，服务端对每个接口强制校验；一个用户可拥有多个角色。
  - 来源：`app/models/user.rb#authorized?`、`right.rb`、`role.rb`
- **FR-AUTH-06**：管理员可查看权限、查看角色详情、为用户添加/移除角色。
  - 来源：`admin/rights`、`admin/roles`（`add_user`、`remove_user`）
- **FR-AUTH-07**：教师、班级家长角色须随当年任课分配自动增删（`adjust_instructor_roles`）。
  - 来源：`app/models/user.rb#adjust_instructor_roles`

---

## 3. 功能需求

优先级：**M**=必须，**S**=应该，**C**=可选。验收标准写成“给定/当/则”。

### 3.1 账号与登录（AUTH）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-AUTH-01 | 用户名+密码登录；登录后跳回原请求页面 | M | 未登录访问受保护页面→跳登录→成功后回到原页面 |
| FR-AUTH-02 | 登出，使会话失效 | M | 登出后再访问受保护接口返回未认证 |
| FR-AUTH-03 | 管理员通过邮件邀请人员注册账号（邀请链接含有时效令牌） | M | 过期/已使用的令牌被拒绝 |
| FR-AUTH-04 | 忘记密码：发送带时效令牌的重置邮件；已登录用户可修改密码 | M | 令牌单次有效、限时 |
| FR-AUTH-08 | 公共页面：联系我们、隐私声明、同意书样例 | S | 无需登录可访问 |

来源：`signin_controller`、`signout_controller`、`timed_token.rb`、`signin_mailer`、`pages_controller`、`home/change_password`

### 3.2 学生家长（STU）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-STU-01 | 维护自己的家庭、家长与孩子信息、地址 | M | 家长只能读写自己家庭的数据 |
| FR-STU-02 | 选择注册偏好（年级/班级偏好、选修课、是否仅注册选修课） | M | 偏好按学年保存 |
| FR-STU-03 | 查看费用明细并以信用卡在线缴费 | M | 金额与 BR 规则一致；成功后生成交易记录与收据邮件 |
| FR-STU-04 | 申请现场缴费（稍后由会计官录入） | M | 生成“待现场缴费”记录，会计官可见 |
| FR-STU-05 | 删除未付款的待处理注册付款 | S | 仅限本人、未付款 |
| FR-STU-06 | 缴费确认页 | M | 显示已缴金额、学生、交易号 |
| FR-STU-07 | 提出退课申请（可选“仅退选修课”）；可取消未处理的申请 | M | 生成待审批请求；仅本人可见/取消 |
| FR-STU-08 | 查看交易历史（本人已付款） | M | 按时间倒序 |
| FR-STU-09 | 首页显示当前学年班级分配 | S | 显示学生、年级班级、选修班 |

来源：`student/registration_controller`、`student/withdraw_controller`、`student/transaction_history_controller`、`student/families_controller`、`student/people_controller`、`home/_student_parent`

### 3.3 注册官（REG）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-REG-01 | 查询/查看/新增人员与家庭 | M | 支持按姓名检索 |
| FR-REG-02 | 为学生选择/调整年级、班级、选修班 | M | 变更保存到当年 `student_class_assignments` |
| FR-REG-03 | 教师任课分配：选择班级、开始/结束日期、角色；删除分配 | M | 保存后自动调整教师/班级家长角色 |
| FR-REG-04 | 自动/随机分配年级班（受学年开关 `auto_class_assignment` 控制） | S | 开关关闭时不自动分班 |
| FR-REG-05 | 班级统计：各年级班/选修班/年级学生人数 | M | 只统计当年已分班学生 |
| FR-REG-06 | 报表：注册完整性检查、同年级兄弟姐妹 | S | 输出与旧系统在同一数据上一致 |
| FR-REG-07 | 名单：按姓名的在读学生名单、按班级学生名单（PDF） | M | 中文姓名正常显示 |

来源：`registration/*`

### 3.4 会计官（ACC）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-ACC-01 | 查看待现场缴费清单并录入现场付款 | M | 录入后标记已付款并触发分班与收据 |
| FR-ACC-02 | 手工交易：新增、列表、查看 | M | 记录金额、原因、操作人 |
| FR-ACC-03 | 注册收款报表：按日期；费用收取汇总 | M | 日期边界以太平洋时间计 |
| FR-ACC-04 | 教师折扣查看/设置 | S | 与 BR-FEE-08 一致 |

来源：`accounting/*`

### 3.5 管理员（ADM）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-ADM-01 | 学年管理：新增/编辑/查看，含费用与日期配置；切换自动分班开关；编辑书本费 | M | 见 BR 中所有 `school_years` 字段；`previous_school_year` 自动关联 |
| FR-ADM-02 | 年级管理 | M | — |
| FR-ADM-03 | 班级管理：新增、编辑、启用/停用（按学年） | M | 未启用班级不出现在分班选项 |
| FR-ADM-04 | 员工分配（staff assignments） | M | 决定员工折扣资格 |
| FR-ADM-05 | 退课请求处理：列表、批准/拒绝 | M | 批准后按 BR-REF 处理副作用 |
| FR-ADM-06 | 邀请注册（见 FR-AUTH-03） | M | — |

来源：`admin/*`

### 3.6 教学（INS）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-INS-01 | 教师查看自己当年所教班级与学生名单 | M | 仅限本人任课班级 |
| FR-INS-02 | 录入/查看期末成绩；下载成绩；查看往年成绩 | M | 录入窗口自 `end_date` 所在年 5 月 1 日起 |
| FR-INS-03 | 教务角色查看所有启用班级 | S | — |

来源：`instruction/*`，`school_year.rb#start_date_for_entering_student_final_mark`

### 3.7 图书（LIB）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-LIB-01 | 图书列表、新增图书、只读视图 | M | — |
| FR-LIB-02 | 借还记录 | M | 记录借出人、时间 |
| FR-LIB-03 | 按学生检索并导出结果（PDF） | S | — |

来源：`librarian/*`、`library_books`、`library_book_checkouts`

### 3.8 通信与表格（COM）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FR-COM-01 | 拍照同意书（PDF） | S | — |
| FR-COM-02 | 年鉴学生名单 | S | — |
| FR-COM-03 | 消防演习表、班级信息、按班级学生名单（`activity/forms`） | S | Q-01 已决：保留；含学生个人信息的名单每次导出写审计日志 |

来源：`communication/forms_controller`、`activity/forms_controller`

### 3.9 邮件通知（MAIL）

| 编号 | 邮件 | 触发 |
|------|------|------|
| FR-MAIL-01 | 账号邀请 / 忘记密码 | 邀请、找回密码 |
| FR-MAIL-02 | 付款确认（收据） | 付款成功 |
| FR-MAIL-03 | 教材通知、注册员通知 | 付款成功且距开学≤1天；注册员通知仅在开学日之后 |
| FR-MAIL-04 | 信用卡交易错误告警（运维） | 网关异常 |
| FR-MAIL-05 | 退课通知：任课教师、家长、注册员、会计、PVA | 退课批准；教师通知仅在距开学≤1天 |

来源：`app/mailers/*`、`app/views/*_mailer/*`

---

## 4. 业务规则（可测试）

> 所有金额为**整数分**（`*_in_cents`）。所有“今天”均指**太平洋时间**日期（`PacificDate.today`）。

### 4.1 学费与费用（BR-FEE）— 来源 `student_fee_payment.rb`

每个学生的费用 = 注册费 + 学费 + 书本费 + 选修课费。

- **BR-FEE-01 注册费**：等于当年 `registration_fee_in_cents`。
- **BR-FEE-02 选修课费**：未选选修课为 0；否则为当年 `elective_class_fee_in_cents`。
- **BR-FEE-03 书本费**：由 `BookCharge` 按学年与年级决定。
- **BR-FEE-04 基础学费**：若今天 ≤ `early_registration_end_date` 且 `early_registration_tuition_in_cents > 0`，用早鸟学费并标记 `early_registration`；否则用 `tuition_in_cents`。
- **BR-FEE-05 亲子班费**：班级类型为“日常中文亲子班”时，学费加上亲子班费（今天 ≤ 早鸟截止日用早鸟亲子班费，否则用标准亲子班费）。
- **BR-FEE-06 Pre-K 折扣**：年级为学前班且 `tuition_discount_for_pre_k_in_cents > 0` 时，学费减该折扣并标记 `pre_k_discount`。
- **BR-FEE-07 多孩折扣**：本次付款/已付款/待付款中，此学生之前已有 ≥ 2 名学生（即第 3 个及以后）且折扣 > 0，学费减 `tuition_discount_for_three_or_more_child_in_cents`。
- **BR-FEE-08 员工与教师折扣**（在迟报折扣之后执行）：
  - 若学生所属家庭当年有员工：仅当已付款与待付款的费用明细中**尚无**员工折扣时，学费置 0 并标记 `staff_discount`（即员工折扣只享受一次）；
  - 若无员工而有教师：教师折扣最多应用于 **2 名**学生，学费减 `tuition_discount_for_instructor_in_cents`（该值 > 0 才生效）；
  - 家庭既有员工又有教师时，仅适用员工折扣。
- **BR-FEE-09 迟报折算**：今天 > `registration_75_percent_date` 时，学费 = `trunc(学费 × 0.75)`，标记 `prorate_75`。（自 2017-18 学年起 50% 折算日期不再使用。）
- **BR-FEE-10 应用顺序**：基础学费 → 亲子班费 → Pre-K 折扣 → 多孩折扣 → 迟报折算 → 员工/教师折扣。
- **BR-FEE-11 舍入**：所有折算使用**截断取整**（`.to_i`），新系统必须复刻。

> 决定（Q-10 已决，2026-11-02）：**忠实复刻**上述顺序。该顺序只影响“迟报的教师家庭”：教师折扣在折算之后减，不被打 75% 折。示例（数字为假设）：学费 600、教师折扣 100 → 现状 600×0.75−100=350；若先减折扣则 (600−100)×0.75=375。黄金用例须专门覆盖“迟报+教师折扣”，并标注为已知且有意保留的行为。
>
> 边界：教师折扣与 Pre-K 折扣均为直接相减、无下限，折扣大于学费时学费为负。默认复刻，并以黄金用例固定该行为；若业务方认为不应出现负学费，再单独修改。会计官对“迟报教师折扣不打折”的确认仍待定。

### 4.2 会费与合计（BR-PAY）— 来源 `registration_payment.rb`

- **BR-PAY-01 PVA 会费**：该家庭本学年已完成注册数 > 0 时为 0；否则为 `pva_membership_due_in_cents`（每家庭一次；2024/04 起与 CCCA 相同规则）。
- **BR-PAY-02 CCCA 会费**：已完成注册数 > 0 → 0；付款人所属任一家庭为 CCCA 终身会员 → 0；否则为 `ccca_membership_due_in_cents`。
- **BR-PAY-03 合计**：`grand_total = pva + ccca + Σ(每名学生 total)`。
- **BR-PAY-04 付款后动作**：创建学生班级分配；发送收据；条件满足时发教材通知与注册员通知（见 FR-MAIL-03）。
- **BR-PAY-05 分类查询**：已付款/待付款/待现场缴费；“某日收款”按太平洋日界线换算 UTC。

### 4.3 退课与退费（BR-REF）— 来源 `school_year.rb`、`withdraw_request*.rb`

- **BR-REF-01 学费退款比例**（Q-11 已决，按顺序判断，先命中先用）：
  1. 学校尚未开学 → 100%；
  2. 今天 > `refund_end_date` → **0（不可退）**；
  3. 今天 > `refund_50_percent_date` → 50%；
  4. 今天 > `refund_90_percent_date` → 90%；
  5. 否则 100%。
  （旧字段 `refund_25_percent_date`、`refund_75_percent_date` 已不再使用，新系统不实现其分支。第 2 步是按意图修正：旧代码该分支恒为假，见下方决定。比例退款用整数运算，取整方式待黄金用例实测后确定。）
- **BR-REF-02 PVA/CCCA 退款**（Q-11 已决，更正）：两项会费均按家庭收取。仅当学校尚未开学、且该家庭退课后已无在读学生时，全额退还该家庭最早一笔已付款中的 PVA 和 CCCA；退课后仍有 1 名或以上学生，或学校已开学，均不退。（2024/4/14 起；旧代码按比例退 PVA 的函数已是死代码，不再实现。）
- **BR-REF-02a 不退项**：注册费不退；书本费仅在学校尚未开学时退；选修课费（整班退或仅退选修课）按全额退，不受日期影响。
- **BR-REF-03 退款合计**：`refund_pva + refund_ccca + Σ(明细：注册费+书本费+学费+选修课费)`。
- **BR-REF-04 副作用（同一事务）**：为每个学生生成 `WithdrawalRecord`（记录注册日期、退课日期、原年级/班级/选修班）；若非“仅退选修课”则将学生状态置为未注册并删除班级分配；若“仅退选修课”则保留班级分配，仅将选修班置 0，并清空注册偏好中的选修班；距开学 ≤ 1 天时通知相关教师。
- **BR-REF-05 状态**：待审批 P、已批准 A、已拒绝 D、已取消 C。

> 决定（Q-11 已决，2026-11-02）：
> 1. 旧代码 `refund_end_date` 判断写成 `!self.refund_end_date && today > refund_end_date`：日期存在时恒为假，截止日之后仍会按比例退款；日期为空时会抛异常。但家长端用 `refund_end_date >= 今天` 决定是否显示退课入口，且退款在提交申请时计算，所以正常使用中截止日后无法提交。新系统**按意图修正为 0**，并在服务端提交和批准时都校验该日期，不依赖界面隐藏入口。
> 2. 只有 50%/90% 两个档位有效，旧的 25%/75% 字段不再实现。
> 3. 黄金用例同时记录旧系统实际输出与新系统修正后输出：非截止日用例两者必须一致；截止日之后新系统为 0。

### 4.4 其他规则（BR-MISC）

- **BR-MISC-01 学年**：`current_school_year` = 结束日期 ≥ 今天的最早学年；`next_school_year` 为其后一个；注册开放学年 = 早鸟开始 ≤ 今天 ≤ 注册结束；退款开放学年 = 退款截止 ≥ 今天。
- **BR-MISC-02 学年校验**：开始日期不得晚于结束日期；多数费用字段须为正整数（折扣字段可为 0）。
- **BR-MISC-03 年龄截止月**：学年配置 `age_cutoff_month` 用于判定学生年级/年龄资格。
- **BR-MISC-04 成绩录入窗口**：自结束年份 5 月 1 日起开放。

---

## 5. 数据需求

- 沿用现有 PostgreSQL 表结构（C-1）。保留的核心表：
  `addresses`、`book_charges`、`families`、`families_children`、`gateway_transactions`、`grades`、`in_person_registration_transactions`、`instructor_assignments`、`library_book_checkouts`、`library_books`、`manual_transactions`、`people`、`registration_payments`、`registration_preferences`、`rights`、`rights_roles`、`roles`、`roles_users`、`school_class_active_flags`、`school_classes`、`school_years`、`staff_assignments`、`student_class_assignments`、`student_fee_payments`、`student_final_marks`、`student_status_flags`、`timed_tokens`、`users`、`withdraw_request_details`、`withdraw_requests`、`withdrawal_records`。
- 删除（范围外）：`track_event_heats`、`track_event_programs`、`track_event_signups`、`track_event_teams`、`jersey_numbers`。（Q-12 已决，2026-11-02）新系统**不迁移**这些表，不纳入数据模型，不得读写。它们在生产库中是切换时物理删除还是保留不碰，尚待定。
- **DATA-01 无 id 联结表**：`families_children(family_id, child_id)`、`rights_roles`、`roles_users`。
- **DATA-02 非常规外键**：`families.parent_one_id/parent_two_id`；`registration_payments.paid_by_id`、`withdraw_requests.request_by_id/status_by_id`、`library_book_checkouts.checked_out_by_id` 等指向 `people`。
- **DATA-03 金额**：全部 `*_in_cents` 整数；新系统不得使用浮点存储或计算金额。
- **DATA-04 用户表密码字段**：`password_hash`（`SHA256(password+salt)` 十六进制）、`password_salt`。（Q-08 已决）新增 `password_hash_v2` 存 argon2id 字符串；旧两列保留到升级截止日后清空并删除。
- **DATA-05 现有数据库中 `db/schema.rb` 为准**，迁移文件不完整（最早 2014 年）；审阅前需拿到脱敏的生产库结构副本核对。

---

## 6. 外部集成

| 编号 | 集成 | 现状 | 需求 |
|------|------|------|------|
| INT-01 | 支付网关 | ActiveMerchant → Authorize.net（`AUTHORIZE_NET_GATEWAY` 常量不在仓库，凭据在服务器上）；卡号不落库，仅存类型/末四位 | 保留功能（Q-02 已决）：继续使用 Authorize.net；改为嵌入式令牌化，卡号由浏览器直接发给网关换令牌，后端只用令牌扣款；支付封装在接口后；凭据改环境变量；见 SEC-05 |
| INT-02 | 邮件 | SMTP；共 4 个 Mailer、10 个模板 | 保留（Q-07 已决）：事务邮件服务（优先 Postmark，或 Amazon SES），经标准 SMTP 对接；发件域名 `to-cs.org`，沿用现有发件地址；SPF/DKIM/DMARC 见 SEC-15 |
| INT-03 | PDF | 7 个 Prawn 模板，其中 2 个属田径（删除）；保留：班级名单×2、图书检索结果、拍照同意书、消防演习表（Q-01 已决：保留，共 5 个） | 保留，含中文字体 |
| INT-04 | CSV | 控制器内联生成（成绩下载、班级信息、学生名单等） | 保留 |
| INT-05 | `data-export/` 脚本 | 独立 Sequel + MySQL 脚本，需手改学年 id 与凭据 | （Q-09 已决）13 个脚本全部迁为后端“报表导出”模块，输出 CSV；学年为页面参数；每个报表有显式权限码；每次导出写审计日志；田径脚本随功能删除。核心功能先做，报表后一期 |

---

## 7. 非功能需求

- **NFR-01 中文**：PDF 与页面完整支持中文（现有内置 Arial Unicode 字体）。
- **NFR-02 时区**：所有业务日期规则按太平洋时间；测试可冻结时间。
- **NFR-03 规模**（Q-03 已决，2026-11-02）：每学年 300–1000 个家庭（约 450–1500 名学生）；注册集中在早鸟截止日前后。单机 2 vCPU / 4GB / 40GB+，按同时在线 150 人、付款约 20 笔/分钟设计，留约 3 倍余量。付款提交必须幂等；费用计算、付款记录与分班在同一数据库事务内完成。验收：早鸟截止前压测 150 并发家长走完整流程（沙箱支付）。假设值待用生产库真实数据校正。
- **NFR-04 可用性**（Q-04 已决，2026-11-02）：单机为单点故障。平时 RPO ≤ 24h；注册开放期 RPO ≤ 1h；RTO ≤ 4h。早鸟截止日前后是否需要热备机待业务方确认。
- **NFR-05 审计**：登录失败、角色/权限变更、退款批准、手工交易、导出个人信息必须留审计日志。
- **NFR-06 可测试性**：BR 规则须有自动化单元测试，覆盖日期边界与舍入。
- **NFR-07 可维护性**：新增接口须显式声明权限码，默认拒绝。

---

## 8. 部署与运维需求（单台 Ubuntu 云服务器）

- **OPS-01 拓扑**：同机运行 反向代理（终止 TLS）→ 后端服务 + 前端静态文件 + PostgreSQL；用 Docker Compose 或 systemd 编排。PostgreSQL 仅监听本机/容器内网。
- **OPS-02 CI/CD**：提交触发 lint → 测试（含真实 PostgreSQL）→ 构建镜像 → 部署；生产部署需人工批准。
- **OPS-03 迁移**：部署时先自动备份，再自动执行数据库迁移；失败自动回滚到上一版本镜像。
- **OPS-04 配置与密钥**：全部使用环境变量/受限权限文件（600），不入库。
- **OPS-05 监控**：`/healthz`、结构化日志、CPU/内存/磁盘/证书到期告警、错误上报；支付失败与邮件失败告警。
- **OPS-06 备份**（Q-04 已决）：平时每日加密 `pg_dump`；注册开放期优先启用 WAL 归档（否则每小时备份）。备份上传前加密，密钥不存放在服务器上，异地保存于另一云厂商账号下的对象存储。保留：日备份 30 天、月备份 12 个月。每学年注册开放前至少做一次恢复演练。
- **OPS-07 单机限制**：无高可用；需要可快速在新机器上按脚本重建（基础设施即代码）。

---

## 9. 安全需求与建议

### 9.1 基于现有代码发现的问题（新系统必须消除）

| 编号 | 现状问题 | 建议 |
|------|----------|------|
| SEC-01 | `routes.rb` 末尾遗留通配路由 `match ':controller(/:action(/:id))'`，使每个控制器 action 都可通过 GET 访问，扩大攻击面且绕过 CSRF | 仅暴露显式声明的接口，默认拒绝；写操作只用 POST/PUT/DELETE |
| SEC-02 | 密码为 `SHA256(password+6字节盐)`，抗暴力破解能力弱；最小长度 6 | 采用 argon2id（或 bcrypt）；提高最小长度；登录限速与锁定；旧哈希在首次登录成功后升级（Q-08） |
| SEC-03 | 权限用 Rails `controller/action` 字符串匹配 | 使用显式权限码；每个接口做**对象级**授权（家长只能访问自己家庭/孩子，防 IDOR） |
| SEC-04 | `sibling_in_same_grade` 使用字符串拼接 SQL | 全部参数化查询；禁止拼接 |
| SEC-05 | 支付：`AUTHORIZE_NET_GATEWAY` 凭据存放位置不明 | 卡号绝不落库、不入日志；**卡号不得经过我们的服务器**（Q-02 已决：嵌入式令牌化，浏览器直接向网关换令牌）；凭据放服务器环境变量并定期轮换；开发/测试只用沙箱账号；对应 PCI 自评表级别在设计阶段对照官方文档确认 |
| SEC-06 | 会话使用 Rails cookie；`TimedToken` 为明文令牌 | Cookie 设 HttpOnly、Secure、SameSite；CSRF 防护；重置/邀请令牌一次性、短时效、**仅存哈希** |
| SEC-07 | `lib/key/`（gitignore）与 `database.yml` 含硬编码用户名 | 仓库不含任何密钥；CI 中启用 secret 扫描 |
| SEC-08 | 含大量未成年人及家长个人信息（姓名、电话、地址） | 最小化字段、按角色脱敏、导出（CSV/PDF）写审计日志、明确保留期限与删除流程 |

### 9.2 Ubuntu 主机加固

- **SEC-10 网络**：仅开放 80/443 与 SSH（UFW + 云安全组双层）；SSH 仅密钥登录、禁 root 与密码登录、限制来源 IP、启用 Fail2ban。
- **SEC-11 系统**：启用 unattended-upgrades 自动安全更新；最小化安装；关闭不用的服务。
- **SEC-12 容器**：非 root 运行、只读根文件系统、丢弃多余 capabilities；不暴露 Docker 守护进程端口。
- **SEC-13 数据库**：仅本机监听；应用使用最小权限专用账号（非超级用户）；`scram-sha-256`；备份加密；磁盘加密（云盘加密）。
- **SEC-14 TLS**：Let's Encrypt 自动续期；HSTS；禁用旧协议；安全响应头（CSP、X-Frame-Options、X-Content-Type-Options、Referrer-Policy）。
- **SEC-15 邮件**（Q-07 已决）：为 `to-cs.org` 配置 SPF、DKIM、DMARC。新发送服务须**合并**进现有 SPF 记录，不得新建第二条；DMARC 先 `p=none` 观察 1–2 周，再升至 `quarantine`。退信率、投诉率与发送失败须告警。
- **SEC-16 供应链**：依赖与镜像漏洞扫描（CI），锁定版本；及时升级。
- **SEC-17 日志与审计**：日志集中保存、限制访问、脱敏（不记录卡号/密码/令牌）；保留期限明确。
- **SEC-18 单机风险**：应用与数据库同机意味着应用被攻破可能波及数据库——数据库账号最小权限、网络隔离（容器内网）、异地加密备份是关键补偿措施。

---

## 10. 迁移与验证策略

- **MIG-01 密码兼容**（Q-08 已决，2026-11-02）：新系统需能校验旧 `SHA256(password+salt)`，旧密码登录成功时静默升级为 argon2id（只换哈希，不改密码）。上线后 6 个月为截止日（避开注册高峰），到期仍为旧哈希的账号作废旧哈希并经邮件重置。新密码规则（最短 10 位）仅在修改/重置密码时生效。登录限速与失败锁定须在上线前完成；登录失败、重置、哈希升级写审计日志。
- **MIG-02 权限映射**：建立旧 (controller, action) → 新权限码映射表，逐条断言角色可访问性与旧系统一致。
- **MIG-03 金额黄金用例**：由旧系统对固定输入（含日期边界、多孩、员工/教师、迟报、亲子班）产出学费/会费/退款金额表，作为新系统必须通过的用例。
- **MIG-04 并行验证**（Q-05 已决，2026-11-02）：新系统只连接生产库的**脱敏副本**，对比人员/班级/交易汇总报表与旧系统输出；新旧系统不共用生产库。
- **MIG-06 切换**（Q-05 已决）：验证通过后，在低峰期（两次注册期之间，避开早鸟截止日）停止旧系统、做最终备份，由新系统一次性接管旧库；任何时刻只有一个系统写库。
- **MIG-05 田径数据**（Q-12 已决）：不迁移，新系统数据模型不含这 5 张表，`grades.jersey_number_prefix` 列同样忽略。库中物理删除或保留不碰待定；若保留，应用账号不授予其权限，且迁移工具不得自动 `DROP`。

---

## 附录 A：技术方案对比（不做决定，供评审）

| 维度 | Django + DRF | NestJS (TypeScript) |
|------|--------------|---------------------|
| 从现有库生成模型 | `inspectdb` | Prisma `db pull` |
| 迁移 | Django migrations（对旧库需 `managed=False` 起步） | Prisma Migrate（需 baseline） |
| 管理后台 | 自带 admin，可替代部分管理页面 | 无，需自建 |
| 权限 | DRF permission classes | Guard/装饰器 |
| 后台任务 | Celery + Redis（或更轻量的 django-q） | BullMQ + Redis |
| PDF（中文） | ReportLab / WeasyPrint | pdfmake / Puppeteer |
| 测试 | pytest-django、freezegun | Jest、fake timers |
| 语言共享 | 前后端不同语言 | 与前端共用 TypeScript，可共享类型/OpenAPI |
| 单机资源 | 内存占用中等；Celery/Redis 为额外进程 | 内存占用中等；Redis 同样额外 |

| 维度 | React | Vue 3 |
|------|-------|-------|
| 构建 | Vite + TypeScript | Vite + TypeScript |
| 路由/状态/请求 | React Router、TanStack Query、Zustand | Vue Router、TanStack Query(Vue)、Pinia |
| UI 库 | MUI 或 Ant Design | Element Plus 或 Ant Design Vue |
| 生态/招聘 | 最大 | 较大，上手快 |
| 与 ERB 的相似度 | 低（JSX） | 较高（模板语法） |

> 单机部署下两种后端差异不大；选型主要取决于团队技能与是否需要自带管理后台。**此表仅供评审，不代表决定。**
>
> **更新（2026-11-02，Q-06 已决）**：后端 NestJS + Prisma，前端 React（Vite + TypeScript）。上表保留作为决策依据。

## 附录 B：术语表（中英对照）

| 中文 | English | 说明 |
|------|---------|------|
| 学年 | School Year | 系统核心配置对象，含费用与日期 |
| 家庭 | Family | 家长（最多两位）与孩子的集合 |
| 人员 | Person | 学生、家长、教师等 |
| 年级 / 班级 | Grade / School Class | 年级班与选修班 |
| 选修班 | Elective Class | 额外收费 |
| 分班 | Class Assignment | 学生与班级的年度关系 |
| 教师任课分配 | Instructor Assignment | 含角色与起止日期 |
| 班级家长 | Room Parent | 由任课分配的角色推导 |
| 员工分配 | Staff Assignment | 决定员工折扣 |
| 注册付款 | Registration Payment | 一次家庭缴费，含多名学生 |
| 学生费用明细 | Student Fee Payment | 每名学生的注册费/学费/书费/选修费 |
| PVA | PVA | 会费之一；只使用缩写，不需要全称（Q-13 已决） |
| CCCA | CCCA | 会费之一，含“终身会员”免收；只使用缩写，不需要全称（Q-13 已决） |
| 早鸟 | Early Registration | 早鸟学费与截止日 |
| 迟报折算 | Late Registration Prorate | 75% 折算 |
| 多孩折扣 | Multiple-Child Discount | 第 3 名及以后学生 |
| 退课 | Withdraw | 退课申请与退费 |
| 期末成绩 | Student Final Mark | 教师在 5 月起录入 |
| 太平洋时间 | Pacific Time | 所有业务日期基准 |
