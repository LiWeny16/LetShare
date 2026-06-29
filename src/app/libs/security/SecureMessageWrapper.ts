/**
 * 安全消息包装器
 * 为RealTimeColab提供透明的加密/解密功能
 * 最小侵入性设计
 */

import { SimpleE2EEncryption, EncryptedTextMessage, UserKeyInfo } from './SimpleE2EEncryption';

export class SecureMessageWrapper {
 private encryption: SimpleE2EEncryption;
 private currentUniqId: string = "";
 private isInitialized: boolean = false;

 constructor() {
  this.encryption = SimpleE2EEncryption.getInstance();
 }

 /**
  * 初始化当前用户的加密功能
  */
 async initialize(uniqId: string): Promise<UserKeyInfo> {
  this.currentUniqId = uniqId;
  
  const keyInfo = await this.encryption.initializeForUser(uniqId);
  this.isInitialized = true;
  
  // console.log(` 安全消息包装器已为 ${uniqId} 初始化`);
  return keyInfo;
 }

 /**
  * 注册其他用户的公钥（在handleDiscover时调用）
  */
 async registerUserKeys(uniqId: string, keyInfo: UserKeyInfo): Promise<void> {
  if (!this.isInitialized) {
   console.warn(" 加密功能未初始化，跳过密钥注册");
   return;
  }
  
  try {
   await this.encryption.registerUserPublicKeys(uniqId, keyInfo);
  } catch (error) {
   console.error(` 注册用户 ${uniqId} 密钥失败:`, error);
   // 如果是签名验证失败，这是严重的安全问题
   if (error instanceof Error && error.message.includes("签名验证失败")) {
    console.error(`检测到可能的中间人攻击！用户 ${uniqId} 的公钥签名无效`);
    throw error; // 重新抛出，让上层处理
   }
  }
 }

 /**
  * 发送前包装消息（自动加密文本消息）
  */
 async wrapOutgoingMessage(targetUniqId: string, message: any): Promise<any> {
  const plaintext =
   typeof message.message === "string"
    ? message.message
    : typeof message.msg === "string"
     ? message.msg
     : undefined;

  // 只对text类型的消息进行加密
  if (message.type === "text" && plaintext !== undefined && this.canEncryptForUser(targetUniqId)) {
   try {
    const encryptedMsg = await this.encryption.encryptTextMessage(
     this.currentUniqId, // 显式传递当前用户ID
     targetUniqId,
     plaintext
    );

    // 返回包装后的消息
    return {
     ...message,
     type: "encrypted_text",
     encryptedMessage: encryptedMsg,
     message: undefined, // 移除明文消息
     msg: undefined
    };
   } catch (error) {
    console.warn(` 消息加密失败，使用明文发送:`, error);
    // 加密失败时回退到明文
    return message;
   }
  }

  // 非文本消息或无法加密时，直接返回原消息
  return message;
 }

 /**
  * 接收后解包消息（自动解密加密消息）
  */
 async unwrapIncomingMessage(fromUniqId: string, message: any): Promise<any> {
  // 只处理加密的文本消息
  if (message.type === "encrypted_text" && message.encryptedMessage) {
   try {
    const decryptedText = await this.encryption.decryptTextMessage(
     fromUniqId, 
     message.encryptedMessage as EncryptedTextMessage
    );
    
    // 返回解密后的消息
    return {
     ...message,
     type: "text",
     message: decryptedText,
     encryptedMessage: undefined // 移除加密数据
    };
   } catch (error) {
    console.error(` 消息解密失败:`, error);
    // 如果是签名验证失败，这是严重的安全问题
    if (error instanceof Error && error.message.includes("签名验证失败")) {
     console.error(`检测到消息篡改！来自 ${fromUniqId} 的消息签名无效`);
     return {
      type: "text",
      message: "[检测到消息篡改，已拒绝显示]",
      error: true
     };
    }
    
    // 其他解密失败情况
    return {
     type: "text",
     message: "[加密消息解密失败]",
     error: true
    };
   }
  }

  // 非加密消息直接返回
  return message;
 }

 /**
  * 检查是否可以与指定用户进行加密通信
  */
 canEncryptForUser(uniqId: string): boolean {
  if (!this.isInitialized) return false;
  return this.encryption.canEncryptForUser(uniqId);
 }

 /**
  * 获取当前用户的公钥信息
  */
 getCurrentUserPublicKeys(): UserKeyInfo | null {
  if (!this.isInitialized) return null;
  return this.encryption.getUserPublicKeys(this.currentUniqId);
 }

 /**
  * 清理用户数据（用户离开时调用）
  */
 clearUserData(uniqId: string): void {
  this.encryption.clearUserData(uniqId);
 }

 /**
  * 检查消息是否为加密消息
  */
 isEncryptedMessage(message: any): boolean {
  return message.type === "encrypted_text" && !!message.encryptedMessage;
 }

 /**
  * 检查是否已初始化
  */
 isReady(): boolean {
  return this.isInitialized;
 }

 /**
  * 获取加密状态信息
  */
 getEncryptionStatus(): {
  initialized: boolean;
  currentUser: string;
  encryptedUsers: string[];
 } {
  const encryptedUsers: string[] = [];
  
  // 这里需要访问encryption的私有属性，实际实现时可能需要添加公共方法
  // 暂时返回基本信息
  
  return {
   initialized: this.isInitialized,
   currentUser: this.currentUniqId,
   encryptedUsers
  };
 }

 /**
  * 获取当前用户ID
  */
 getCurrentUniqId(): string {
  return this.currentUniqId;
 }
}
