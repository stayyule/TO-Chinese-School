# 审阅清单 / Review Checklist

状态 Status：`Open` 待决 · `Decided` 已决。请在“决定/Decision”列填写结论，并写上负责人与日期。
Fill in the Decision column and record the owner and date.

## A. 待决问题 / Open Questions

| ID | 问题 / Question | 影响章节 / Sections | 建议 / Recommendation | 负责人 Owner | 状态 | 决定 / Decision |
|----|-----------------|---------------------|-----------------------|--------------|------|-----------------|
| Q-01 | `activity/forms`（消防演习表、班级信息、按班级学生名单）与 `communication/forms` 是否保留？<br>Keep `activity/forms` (fire drill form, class info, students by class) and `communication/forms`? | 3.8, INT-03 | 保留（与田径无关）/ Keep (unrelated to track) | | Open | |
| Q-02 | 是否继续使用 Authorize.net？凭据/沙箱如何提供？<br>Continue with Authorize.net? How will credentials/sandbox be provided? | INT-01, SEC-05 | 继续；用环境变量；提供沙箱账号 / Continue; env vars; provide sandbox account | | Open | |
| Q-03 | 用户规模与注册高峰并发？<br>User count and registration-peak concurrency? | NFR-03 | 提供数字后评估单机容量 / Provide numbers, then size the single host | | Open | |
| Q-04 | RTO/RPO 目标与异地备份位置？<br>RTO/RPO targets and off-host backup location? | NFR-04, OPS-06 | 例如 RPO ≤ 24h、RTO ≤ 4h（需业务确认）/ e.g. RPO ≤ 24h, RTO ≤ 4h (needs business confirmation) | | Open | |
| Q-05 | 新旧系统并行期间是否共用同一 PostgreSQL 库？<br>Share one PostgreSQL DB between old and new systems during parallel run? | 10 | 先用脱敏副本验证，再决定 / Validate on a sanitized copy first | | Open | |
| Q-06 | 后端（Django+DRF / NestJS）与前端（React / Vue）最终选择？<br>Final choice of back end (Django+DRF / NestJS) and front end (React / Vue)? | 附录 A / Appendix A | 由团队技能决定 / Decide by team skills | | Open | |
| Q-07 | 生产 SMTP 提供方与发件域名？<br>Production SMTP provider and sending domain? | INT-02, SEC-15 | 提供后配置 SPF/DKIM/DMARC / Then configure SPF/DKIM/DMARC | | Open | |
| Q-08 | 旧密码升级：首次登录静默升级，还是强制全员重置？<br>Legacy passwords: silent upgrade on first sign-in, or force a reset for everyone? | SEC-02, MIG-01 | 静默升级 + 设定截止日后强制重置未升级账号 / Silent upgrade, then force-reset remaining accounts after a deadline | | Open | |
| Q-09 | `data-export/` 脚本迁移为后端报表功能，还是继续独立保留？<br>Move `data-export/` scripts into back-end reports, or keep them standalone? | INT-05 | 按使用频率决定；先列出仍在使用的脚本 / Decide by usage; list scripts still in use | | Open | |
| Q-10 | 费用计算顺序（迟报折算在员工/教师折扣之前）是否为预期？<br>Is the fee order (late proration before staff/instructor discount) intended? | BR-FEE-10 | 忠实复刻，除非业务方要求修改 / Reproduce faithfully unless business owners ask otherwise | | Open | |
| Q-11 | 退款：`refund_end_date` 之后仍按比例退款（疑似缺陷）——复刻还是按意图修正为 0？<br>Refund: proportional refund continues after `refund_end_date` (suspected defect) — reproduce, or fix to 0? | BR-REF-01 | 业务方决定；两种都写入黄金用例 / Business decides; record both in golden cases | | Open | |
| Q-12 | 田径相关 5 张表：物理删除，还是保留但不读写？<br>The 5 track tables: physically drop, or keep but never touch? | 5, MIG-05 | 先导出归档，确认无用后再删 / Export to archive first, drop after confirmation | | Open | |
| Q-13 | PVA、CCCA 缩写全称（用于术语表与界面文案）？<br>Full names of PVA and CCCA (for glossary and UI text)? | 附录 B / Appendix B | 业务方补充 / Business owners to supply | | Open | |

## B. 章节审阅签核 / Section Sign-off

| 章节 / Section | 审阅角色 / Reviewer role | 审阅人 Reviewer | 日期 Date | 结论 Result（通过/需修改 · Approved/Changes needed） |
|----------------|--------------------------|-----------------|-----------|------------------------------------------------------|
| 1 范围 / Scope | 校长 / Principal | | | |
| 3.2 学生家长 / Student Parent | 注册官 / Registration Officer | | | |
| 3.3 注册官 / Registration | 注册官 / Registration Officer | | | |
| 3.4 会计官 / Accounting | 会计官 / Accounting Officer | | | |
| 3.5 管理员 / Admin | 系统管理员 / Administrator | | | |
| 3.6 教学 / Instruction | 教务官 / Instruction Officer | | | |
| 3.7 图书 / Library | 图书管理员 / Librarian | | | |
| 3.8 通信 / Communication | 通信官 / Communication Officer | | | |
| 4 业务规则 / Business Rules | 会计官 + 注册官 / Accounting + Registration | | | |
| 5–6 数据与集成 / Data & Integrations | 技术负责人 / Tech lead | | | |
| 8–9 运维与安全 / Ops & Security | 技术负责人 / Tech lead | | | |

## C. 审阅方法 / How to review

1. 逐节阅读中文版或英文版（编号一致），在本文件登记问题；<br>Read a section in either language (numbering is identical) and log issues here.
2. 第 4 节每条规则请用真实案例核对：给出输入（日期、学生数、折扣资格）→ 期望金额，作为“黄金用例”；<br>For Section 4, verify each rule with real cases: input (date, student count, discount eligibility) → expected amount; these become the golden cases.
3. 所有 Open 项决定后，才进入技术选型与实现计划。<br>Only after all Open items are decided do we proceed to technology selection and an implementation plan.
