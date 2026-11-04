# TOCS 新系统演示流程(阶段 1:基础功能)

演示对象:分支 `feat/subproject-1-foundation` 中替换旧 Rails 应用的新代码(NestJS 后端 + React/Vite 前端)。
预计时长:约 15 分钟。语言:界面为英文,数据含中英文姓名。

> 标记说明:✅ = 已在本机彩排验证;⚠️ = 按代码推断,尚未实际点过,正式演示前请先走一遍。

## 1. 演示前准备(提前 10 分钟)

1. 启动环境:按 `.claude/skills/start-demo/SKILL.md`(Claude 里说"启动演示应用"即可)。
   需要运行:WSL Docker 里的 Postgres 与 Mailpit、后端(:3000)、前端(:5173)。
2. 灌入演示数据(只需一次):
   ```bash
   node .claude/skills/start-demo/seed-demo-data.mjs
   ```
   脚本遇到已有学年会拒绝重复灌入。要重来:`docker compose -p tocs-dev down -v`,再重新初始化数据库、建 `demo-admin`、重新灌数据。
3. 打开两个浏览器窗口(或一个普通窗口 + 一个无痕窗口),方便在不同角色间切换:
   - 前端:http://localhost:5173
   - 邮箱(Mailpit):http://localhost:8025

## 2. 演示账号

所有账号密码相同:`Demo-Passw0rd-2026`(仅限本地开发环境)。

| 用户名 | 角色 | 用来展示什么 |
|---|---|---|
| `demo-admin` | Super User | 拥有全部权限,管理学年、班级、角色 |
| `registrar` | Registration Officer | 注册组:查人、建家庭、管学年与班级(20 项权限) |
| `principal` | Principal | 只有校长面板(1 项权限),用来展示"默认拒绝" |
| `parent-chen` | Student Parent | 家长自助:只能看和改自己的家庭(7 项权限) |

## 3. 演示数据一览

- **年级**(8 个,按升级顺序串联):Pre-K → Kindergarten → Grade 1 … Grade 6。
- **学年**:2026-2027(当前,学费 $520)、2027-2028(下一学年,学费 $540);每个学年按年级配置了教材费。
- **班级**(15 个):年级班 9 个(简体 S / 繁体 T / 混合 M)、英语教学 SE、成人生活华语 EC、选修 ELECTIVE 4 个(国画、书法、民族舞、珠算)。
  **珠算(Abacus)今年故意设为未启用**,用来演示启用开关。
- **家庭**(6 个,共 24 人):
  | 家庭 | 家长 | 孩子 |
  |---|---|---|
  | Chen 陳 | Wei 陳偉、Mei 林美 | Emily、Kevin |
  | Lin 林 | Jun 林軍、Hui 黃慧 | Grace |
  | Wang 王 | Tao 王濤、Li 李麗 | Ethan、Olivia、Lucas(三个孩子,用于展示"三孩优惠"相关学费规则) |
  | Zhang 張 | Ming 張明(单亲) | Sophia |
  | Liu 劉 | Yan 劉艷、Hao 劉皓 | Daniel、Chloe |
  | Huang 黃 | Qiang 黃強、Xia 夏霞 | Ryan、Anna |

## 4. 演示流程

### 第 1 幕:登录与首页(2 分钟)

1. ✅ 打开 http://localhost:5173/signin,用 `demo-admin` 登录。
2. ✅ 首页按角色分成多个"资源面板"(Principal / Academic Vice Principal / Registration Officer / …),有权限的面板里才有链接,其余显示 "No resources are available here yet."。
3. 讲解点:顶部菜单(Home / Parent / Registration / Accounting / Admin …)同样由权限决定;这只是界面提示,真正的拦截在后端接口。
4. 提一句:登录页还提供找回用户名、找回密码、新用户注册入口(⚠️ 未实际走过)。

### 第 2 幕:学年管理(3 分钟)

1. ✅ 菜单 Admin → School years:看到 2026-2027、2027-2028 两个学年,含起止日期与学费。
2. ⚠️ 点 **Edit** 进入某学年:展示报名/退费日期节点(早鸟报名、75% 费用日、退费 90% / 50% 截止等)和各项费用(以美分存储,界面显示美元)。
3. ⚠️ 点 **Book charges**:按年级设置教材费。
4. ⚠️ 点 **New school year**:演示表单校验(留空必填项会逐字段提示错误;开始日期晚于结束日期会报错)。
5. 讲解点:已过去的日期会被冻结,不能再改(沿用旧系统规则);当前学年用 `Pacific` 时区计算。

### 第 3 幕:班级管理(3 分钟)

1. ✅ Admin → School classes:15 个班级,两列开关分别是"今年启用 / 明年启用"。
2. ✅ 指出 **Abacus 今年为关闭**、明年为开启。
3. ⚠️ 点开关把 Abacus 今年改为启用,再改回去,说明每个班级按学年独立启用。
4. ⚠️ **New school class**:新建一个选修班(类型选 ELECTIVE),并可选绑定年级、设置人数上限与教室。

### 第 4 幕:注册组工作台——查人、建家庭(4 分钟)

建议这一幕换成 `registrar` 登录,顺带说明角色差异。

1. ✅ Registration → People:列出 25 人(含中英文姓名),分页显示总数。
2. ⚠️ 搜索一个名字(如 "Chen"),点进某人查看详情;点进 Chen 家庭(`/registration/families/1`)。
3. ✅ 家庭页:Parent one / Parent two / Children(带出生年月)/ 地址与电话。
4. ⚠️ 在家庭页点 **Add child** 添加一个孩子(必填:性别 M/F、出生年月)。
5. ⚠️ Home → **Register a new family**:用新家庭走一遍——先填地址(街道、城市、州、邮编、家庭电话、邮箱必填),再填第一位家长。
6. 讲解点:电话号码统一只存数字;出生年份必须在 1900 年之后且早于当前年。

### 第 5 幕:家长自助(2 分钟)

用无痕窗口以 `parent-chen` 登录。

1. ⚠️ 菜单只有 Home、Parent;进入 Parent → My family:只看到自己家庭(Chen)。
2. ⚠️ 修改地址、添加家长/孩子、修改个人资料——但无法看到其他家庭。
3. ⚠️ 手动访问 `/registration/people` 会得到 Forbidden 页面(无权限)。
4. 讲解点:家长权限只有 7 项,全部是 "self" 类,后端按登录人的家庭过滤数据,不是前端隐藏。

### 第 6 幕:权限与角色(2 分钟)

1. ✅(接口层验证)用 `principal` 登录:只有 1 项权限,首页只有校长面板。
2. ⚠️ 回到 `demo-admin`:Admin → Roles,查看 13 个角色及其成员;Super User 默认拥有全部权限,其他角色只拿各自面板。
3. ⚠️ 打开某角色详情,展示给用户加入/移出角色(系统会拒绝移除最后一个 Super User,且只有 Super User 能改 Super User 成员)。
4. 讲解点:新系统是"默认拒绝"——每个接口都必须声明所需权限,启动时有路由覆盖检查,漏标会直接报错。

### 第 7 幕:邀请注册(可选,2 分钟)⚠️

1. Admin → Invitations:给某人的邮箱发送邀请。
2. 打开 Mailpit(http://localhost:8025)找到邮件,点击链接,走 `register-with-invitation` 完成注册。
3. 讲解点:旧系统密码(SHA256+salt)仍可登录,登录成功后自动升级为 argon2id;新密码至少 10 位;登录失败有限流与锁定。

## 5. 收尾话术(30 秒)

- 本阶段范围:登录/注册/找回、权限与角色、人员与家庭、学年、班级。
- Accounting、Instruction、Communication 等菜单目前只是占位页面,属于后续阶段。
- 数据层:沿用旧库的 29 张表,新增表只做增量迁移,不改旧表,因此可以直接在生产库上平滑切换。

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| 页面打不开 / 登录无响应 | 检查后端 :3000 与前端 :5173 是否在运行;后端是 watch 模式,保存文件会短暂重启,等几秒再试 |
| 登录报 CSRF 或 cookie 问题 | 必须用 `http://localhost`(不要用 IP 或别的主机名),cookie 带 Secure 标记 |
| 数据库连不上 | `wsl -d Ubuntu-22.04 -- docker ps` 确认 `tocs-dev-postgres-1` 在运行 |
| 想恢复初始演示状态 | `docker compose -p tocs-dev down -v` 后重新初始化、建账号、灌数据(见 SKILL.md) |
| 灌数据脚本中途失败 | 删除已写入的学年/班级相关表数据后重跑(脚本拒绝在已有学年时运行) |
