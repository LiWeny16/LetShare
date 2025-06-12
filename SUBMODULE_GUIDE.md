# Git Submodule 操作指南

## 概述
本项目使用Git Submodule管理后端代码。主项目追踪submodule的特定版本，而不是最新版本。

## 目录结构
```
LetShare/                 # 主项目（前端）
├── src/
├── package.json
├── .git/                 # 主项目的git仓库
└── server/               # Submodule（后端）
    ├── .git             # Submodule的git仓库
    └── ...              # 后端代码
```

## 代码提交策略

### 场景1：修改后端代码（在server目录下操作）

```bash
# 1. 进入server目录
cd server

# 2. 查看状态
git status

# 3. 添加修改的文件
git add .

# 4. 提交到submodule
git commit -m "feat: 添加新的API接口"

# 5. 推送到submodule的远程仓库
git push origin main
```

### 场景2：更新主项目中的submodule版本（在根目录下操作）

```bash
# 1. 回到主项目根目录
cd ..

# 2. 查看submodule状态
git status
# 会显示: modified: server (new commits)

# 3. 添加submodule的版本更新
git add server

# 4. 提交版本更新到主项目
git commit -m "update: 更新server到最新版本"

# 5. 推送主项目
git push origin main
```

### 场景3：同时修改前后端代码

```bash
# 1. 先提交后端代码
cd server
git add .
git commit -m "feat: 后端新功能"
git push origin main

# 2. 回到主项目，修改前端代码
cd ..
git add src/
git commit -m "feat: 前端新功能"

# 3. 更新submodule版本引用
git add server
git commit -m "update: 同步后端更新"

# 4. 推送主项目
git push origin main
```

## 团队协作

### 克隆包含submodule的项目
```bash
# 方法1：一次性克隆所有内容
git clone --recursive https://github.com/你的用户名/LetShare.git

# 方法2：先克隆主项目，再初始化submodule
git clone https://github.com/你的用户名/LetShare.git
cd LetShare
git submodule init
git submodule update
```

### 更新submodule到最新版本
```bash
# 1. 更新submodule到远程最新版本
git submodule update --remote server

# 2. 如果有更新，提交这个变更
git add server
git commit -m "update: 更新server submodule到最新版本"
git push origin main
```

### 拉取包含submodule更新的代码
```bash
# 1. 拉取主项目更新
git pull origin main

# 2. 更新submodule（如果主项目更新了submodule版本）
git submodule update --init --recursive
```

## 常用命令

### 查看submodule状态
```bash
# 查看submodule状态
git submodule status

# 查看详细信息
git submodule foreach 'git status'
```

### 进入submodule进行开发
```bash
# 确保submodule在正确的分支上
cd server
git checkout main
git pull origin main
```

### 批量操作所有submodule
```bash
# 在所有submodule中执行命令
git submodule foreach 'git pull origin main'
```

## 最佳实践

### 1. 工作流程
1. **开发后端**：在`server/`目录下进行git操作
2. **开发前端**：在根目录下进行git操作  
3. **版本同步**：定期更新主项目中的submodule引用

### 2. 分支管理
```bash
# 在submodule中创建功能分支
cd server
git checkout -b feature/new-api
# 开发完成后合并到main分支

# 主项目始终引用submodule的稳定版本
```

### 3. 避免的问题
- ❌ 不要在根目录下直接修改server/中的文件然后用主项目git提交
- ❌ 不要忘记推送submodule的更改就更新主项目引用
- ✅ 总是先提交submodule，再更新主项目引用

## 示例工作流程

```bash
# 完整的开发流程示例

# 1. 开发新功能（后端）
cd server
git checkout -b feature/user-auth
# ... 编写代码 ...
git add .
git commit -m "feat: 添加用户认证功能"
git push origin feature/user-auth

# 2. 合并到主分支
git checkout main
git merge feature/user-auth
git push origin main

# 3. 开发对应的前端功能
cd ..
# ... 修改前端代码 ...
git add src/
git commit -m "feat: 前端用户认证界面"

# 4. 更新submodule引用
git add server
git commit -m "update: 同步后端用户认证功能"

# 5. 推送完整更新
git push origin main
```

## 故障排除

### Submodule显示为脏工作区
```bash
# 如果submodule显示有未提交的更改
cd server
git status
git stash  # 或者提交更改
cd ..
git submodule update
```

### 重置submodule
```bash
# 完全重置submodule到主项目引用的版本
git submodule deinit server
git submodule update --init server
```

### 更换submodule URL
```bash
# 如果需要更换submodule的远程URL
git submodule set-url server https://new-url.git
```

---

记住：**Submodule内的代码在server/下提交，主项目的submodule版本引用在根目录下提交！**
