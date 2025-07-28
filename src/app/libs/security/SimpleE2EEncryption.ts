/**
 * 简化的端到端加密模块
 * 专注于文本消息加密，使用uniqId作为密钥基准
 * 设计目标：最小侵入性，仅加密文本消息
 */

export interface EncryptedTextMessage {
  encryptedData: string;
  iv: string;
  timestamp: number;
  fromUniqId: string;
  signature: string; // 🔐 添加签名字段
}

export interface UserKeyInfo {
  publicKeyDH: string;
  publicKeySign: string;
  signature: string; // 🔐 添加对DH公钥的签名
}

export class SimpleE2EEncryption {
  private static instance: SimpleE2EEncryption | null = null;
  private keyPairs: Map<string, CryptoKeyPair> = new Map(); // DH密钥对
  private signingKeys: Map<string, CryptoKeyPair> = new Map(); // 签名密钥对
  private sharedSecrets: Map<string, CryptoKey> = new Map(); // 与其他用户的共享密钥
  private userPublicKeys: Map<string, UserKeyInfo> = new Map(); // 其他用户的公钥
  private processedMessages: Set<string> = new Set(); // 防重放攻击

  private constructor() {}

  public static getInstance(): SimpleE2EEncryption {
    if (!SimpleE2EEncryption.instance) {
      SimpleE2EEncryption.instance = new SimpleE2EEncryption();
    }
    return SimpleE2EEncryption.instance;
  }

  /**
   * 基于uniqId初始化当前用户的密钥对
   */
  async initializeForUser(uniqId: string): Promise<UserKeyInfo> {
    // 使用uniqId作为种子生成一致的密钥对
    const seed = await this.generateSeedFromUniqId(uniqId);
    
    // 生成DH密钥对用于密钥交换
    const dhKeyPair = await this.generateDeterministicKeyPair(seed, "ECDH");
    this.keyPairs.set(uniqId, dhKeyPair);

    // 生成签名密钥对
    const signKeyPair = await this.generateDeterministicKeyPair(seed + "_sign", "ECDSA");
    this.signingKeys.set(uniqId, signKeyPair);

    // 导出公钥
    const publicKeyDH = await this.exportPublicKey(dhKeyPair.publicKey);
    const publicKeySign = await this.exportPublicKey(signKeyPair.publicKey);

    // 🔐 用签名私钥对DH公钥进行签名
    const signature = await this.signPublicKey(signKeyPair.privateKey, publicKeyDH);

    console.log(`🔐 已为用户 ${uniqId} 初始化加密密钥`);
    
    return { publicKeyDH, publicKeySign, signature };
  }

  /**
   * 从uniqId生成确定性种子
   */
  private async generateSeedFromUniqId(uniqId: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(uniqId + "LetShare_E2E_Seed");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    return btoa(String.fromCharCode(...hashArray));
  }

  /**
   * 生成确定性密钥对（基于种子）
   */
  private async generateDeterministicKeyPair(_seed: string, algorithm: "ECDH" | "ECDSA"): Promise<CryptoKeyPair> {
    // 注意：实际实现中应该使用更安全的确定性密钥生成方法
    // 这里为了简化，直接生成随机密钥对
    const keyUsages = algorithm === "ECDH" ? ["deriveKey"] : ["sign", "verify"];
    
    return await crypto.subtle.generateKey(
      {
        name: algorithm,
        namedCurve: "P-256"
      },
      true,
      keyUsages as KeyUsage[]
    );
  }

  /**
   * 注册其他用户的公钥（带签名验证）
   */
  async registerUserPublicKeys(uniqId: string, keyInfo: UserKeyInfo): Promise<void> {
    // 🔐 验证公钥签名
    const isValidSignature = await this.verifyPublicKeySignature(
      keyInfo.publicKeySign,
      keyInfo.publicKeyDH,
      keyInfo.signature
    );

    if (!isValidSignature) {
      throw new Error(`🔐 用户 ${uniqId} 的公钥签名验证失败，可能存在中间人攻击`);
    }

    console.log(`🔐 ✅ 用户 ${uniqId} 的公钥签名验证通过`);

    this.userPublicKeys.set(uniqId, keyInfo);
    
    // 计算与该用户的共享密钥
    await this.computeSharedSecret(uniqId, keyInfo.publicKeyDH);
    
    console.log(`🔑 已注册用户 ${uniqId} 的公钥并计算共享密钥`);
  }

  /**
   * 计算与指定用户的共享密钥
   */
  private async computeSharedSecret(remoteUniqId: string, remoteDHPublicKey: string): Promise<void> {
    // 🔧 通过参数获取当前用户ID，不再依赖内部方法
    const allUsers = Array.from(this.keyPairs.keys());
    if (allUsers.length === 0) {
      throw new Error("本地密钥对未初始化");
    }
    
    // 假设当前只有一个用户（当前用户）的密钥对
    const myUniqId = allUsers[0];
    const myKeyPair = this.keyPairs.get(myUniqId);
    
    if (!myKeyPair) {
      throw new Error("本地密钥对未初始化");
    }

    // 导入对方的DH公钥
    const remotePublicKey = await this.importPublicKey(remoteDHPublicKey, "ECDH");
    
    // 生成共享密钥
    const sharedSecret = await crypto.subtle.deriveKey(
      {
        name: "ECDH",
        public: remotePublicKey
      },
      myKeyPair.privateKey,
      {
        name: "AES-GCM",
        length: 256
      },
      false,
      ["encrypt", "decrypt"]
    );

    this.sharedSecrets.set(remoteUniqId, sharedSecret);
  }

  /**
   * 加密文本消息
   */
  async encryptTextMessage(fromUniqId: string, targetUniqId: string, plaintext: string): Promise<EncryptedTextMessage> {
    const sharedSecret = this.sharedSecrets.get(targetUniqId);
    if (!sharedSecret) {
      throw new Error(`与用户 ${targetUniqId} 的共享密钥未建立`);
    }

    // 生成随机IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const timestamp = Date.now();

    // 准备要加密的数据
    const messageData = {
      content: plaintext,
      timestamp,
      fromUniqId: fromUniqId
    };

    // 使用AES-GCM加密
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      sharedSecret,
      new TextEncoder().encode(JSON.stringify(messageData))
    );

    const encryptedData = btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));
    const ivString = btoa(String.fromCharCode(...iv));

    // 🔐 对加密消息进行签名
    const signingKeyPair = this.signingKeys.get(fromUniqId);
    if (!signingKeyPair) {
      throw new Error(`用户 ${fromUniqId} 的签名密钥未找到`);
    }

    const messageToSign = encryptedData + ivString + timestamp.toString();
    const signature = await this.signData(signingKeyPair.privateKey, messageToSign);

    return {
      encryptedData,
      iv: ivString,
      timestamp,
      fromUniqId,
      signature
    };
  }

  /**
   * 解密文本消息
   */
  async decryptTextMessage(fromUniqId: string, encryptedMessage: EncryptedTextMessage): Promise<string> {
    const sharedSecret = this.sharedSecrets.get(fromUniqId);
    if (!sharedSecret) {
      throw new Error(`与用户 ${fromUniqId} 的共享密钥未建立`);
    }

    // 防重放攻击检查
    const messageId = `${fromUniqId}_${encryptedMessage.timestamp}_${encryptedMessage.iv}`;
    if (this.processedMessages.has(messageId)) {
      throw new Error("检测到重放攻击");
    }

    // 时间戳验证（5分钟内有效）
    const now = Date.now();
    if (now - encryptedMessage.timestamp > 5 * 60 * 1000) {
      throw new Error("消息已过期");
    }

    // 🔐 验证消息签名
    const userKeyInfo = this.userPublicKeys.get(fromUniqId);
    if (userKeyInfo) {
      const senderSignPublicKey = await this.importPublicKey(userKeyInfo.publicKeySign, "ECDSA");
      const messageToVerify = encryptedMessage.encryptedData + encryptedMessage.iv + encryptedMessage.timestamp.toString();
      
      const isValidSignature = await this.verifyDataSignature(
        senderSignPublicKey,
        encryptedMessage.signature,
        messageToVerify
      );

      if (!isValidSignature) {
        throw new Error("🔐 消息签名验证失败，消息可能被篡改");
      }
    }

    try {
      // 解密
      const encryptedData = Uint8Array.from(atob(encryptedMessage.encryptedData), c => c.charCodeAt(0));
      const iv = Uint8Array.from(atob(encryptedMessage.iv), c => c.charCodeAt(0));

      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        sharedSecret,
        encryptedData
      );

      const decryptedText = new TextDecoder().decode(decryptedBuffer);
      const messageData = JSON.parse(decryptedText);

      // 验证发送者
      if (messageData.fromUniqId !== fromUniqId) {
        throw new Error("发送者身份验证失败");
      }

      // 记录已处理的消息
      this.processedMessages.add(messageId);
      
      // 清理过期的消息记录
      this.cleanupProcessedMessages();

      console.log(`🔓 成功解密来自用户 ${fromUniqId} 的消息`);
      return messageData.content;

    } catch (error) {
      console.error("解密失败:", error);
      throw new Error("消息解密失败");
    }
  }

  /**
   * 检查是否可以与指定用户进行加密通信
   */
  canEncryptForUser(uniqId: string): boolean {
    return this.sharedSecrets.has(uniqId);
  }

  /**
   * 获取指定用户的公钥信息
   */
  getUserPublicKeys(uniqId: string): UserKeyInfo | null {
    return this.userPublicKeys.get(uniqId) || null;
  }

  /**
   * 清理用户相关的加密数据
   */
  clearUserData(uniqId: string): void {
    this.sharedSecrets.delete(uniqId);
    this.userPublicKeys.delete(uniqId);
    
    // 清理相关的已处理消息记录
    const messagesToRemove: string[] = [];
    this.processedMessages.forEach(messageId => {
      if (messageId.startsWith(uniqId + "_")) {
        messagesToRemove.push(messageId);
      }
    });
    messagesToRemove.forEach(messageId => this.processedMessages.delete(messageId));
    
    console.log(`🧹 已清理用户 ${uniqId} 的加密数据`);
  }

  /**
   * 清理过期的已处理消息记录
   */
  private cleanupProcessedMessages(): void {
    const now = Date.now();
    const expiredMessages: string[] = [];
    
    this.processedMessages.forEach(messageId => {
      const parts = messageId.split('_');
      if (parts.length >= 2) {
        const timestamp = parseInt(parts[1]);
        if (now - timestamp > 5 * 60 * 1000) { // 5分钟过期
          expiredMessages.push(messageId);
        }
      }
    });
    
    expiredMessages.forEach(messageId => this.processedMessages.delete(messageId));
  }

  /**
   * 🔐 对公钥进行签名
   */
  private async signPublicKey(privateKey: CryptoKey, publicKeyString: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(publicKeyString);
    
    const signature = await crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: "SHA-256"
      },
      privateKey,
      data
    );
    
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  /**
   * 🔐 验证公钥签名
   */
  private async verifyPublicKeySignature(signPublicKey: string, dhPublicKey: string, signature: string): Promise<boolean> {
    try {
      const publicKey = await this.importPublicKey(signPublicKey, "ECDSA");
      const encoder = new TextEncoder();
      const data = encoder.encode(dhPublicKey);
      const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

      return await crypto.subtle.verify(
        {
          name: "ECDSA",
          hash: "SHA-256"
        },
        publicKey,
        signatureBytes,
        data
      );
    } catch (error) {
      console.error("公钥签名验证失败:", error);
      return false;
    }
  }

  /**
   * 🔐 对数据进行签名
   */
  private async signData(privateKey: CryptoKey, data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);
    
    const signature = await crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: "SHA-256"
      },
      privateKey,
      dataBytes
    );
    
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  /**
   * 🔐 验证数据签名
   */
  private async verifyDataSignature(publicKey: CryptoKey, signature: string, data: string): Promise<boolean> {
    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);
      const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

      return await crypto.subtle.verify(
        {
          name: "ECDSA",
          hash: "SHA-256"
        },
        publicKey,
        signatureBytes,
        dataBytes
      );
    } catch (error) {
      console.error("数据签名验证失败:", error);
      return false;
    }
  }

  /**
   * 导出公钥为Base64字符串
   */
  private async exportPublicKey(publicKey: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey("spki", publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  }

  /**
   * 从Base64字符串导入公钥
   */
  private async importPublicKey(publicKeyBase64: string, algorithm: "ECDH" | "ECDSA"): Promise<CryptoKey> {
    const keyData = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
    const keyUsage: KeyUsage[] = algorithm === "ECDH" ? ["deriveKey"] : ["verify"];
    
    return await crypto.subtle.importKey(
      "spki",
      keyData,
      {
        name: algorithm,
        namedCurve: "P-256"
      },
      false,
      keyUsage
    );
  }
} 