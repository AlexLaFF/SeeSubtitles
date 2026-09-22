import Foundation
import Security

/// The account's bearer token, kept in the Keychain: the one secret this app holds. It is the server's token for
/// this device, revocable from any other (Settings › Devices); the Tencent and TokenHub keys never come here.
enum Keychain {
  private static let service = "com.algernonlabs.seesubtitles"

  static func read(_ account: String) -> String? {
    let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account, kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]
    var out: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func write(_ value: String?, for account: String) {
    let base: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
    SecItemDelete(base as CFDictionary)
    guard let value else { return }
    var add = base
    add[kSecValueData] = Data(value.utf8)
    // readable after the first unlock, so a talk that is running keeps its connection with the screen locked
    add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(add as CFDictionary, nil)
  }
}
