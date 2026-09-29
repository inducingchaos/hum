// The Dropbox refresh token lives in the Keychain, readable after the first
// unlock so a locked phone can still refresh while playing.
import Foundation
import Security

nonisolated enum Keychain {
  private static let service = "com.rileybarabash.hum"

  static func get(_ key: String) -> String? {
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key,
      kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func set(_ key: String, _ value: String) {
    delete(key)
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key,
      kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    SecItemAdd(q as CFDictionary, nil)
  }

  static func delete(_ key: String) {
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    SecItemDelete(q as CFDictionary)
  }
}
