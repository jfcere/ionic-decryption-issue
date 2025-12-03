# Reproduction Sample

This is a reproduction sample of the issue with `Identity-Vault` where decrypting on Android sometimes throw `IllegalBlockSizeException`.

The issue occurs intermittently when decrypting, because manually chunking the ciphertext can sometimes break the 16-byte alignment, which triggers the `IllegalBlockSizeException`.

## Table Of Content

- [Starting project](#starting-project)
- [Project description](#project-description)
- [Why the issue might not reproduce on the Android emulator](#-why-the-issue-might-not-reproduce-on-the-android-emulator)
- [Description of the Issue](#description-of-the-issue)
- [Proposed Solution](#proposed-solution)

## Starting project

1. Create `.npmrc` file at the root of the project to include a registry for `@ionic-enterprise` packages and replace `ENTER_YOUR_TOKEN_HERE` with your Ionic access token

```
@ionic-enterprise:registry=https://registry.ionicframework.com/
//registry.ionicframework.com/:_authToken=ENTER_YOUR_TOKEN_HERE
```

2. Install dependencies

```bash
npm install
```

3. Build ionic

```bash
npx ionic build
```

4. Sync capacitor

```bash
npx cap sync
```

5. Open the project in Android Studio

```bash
npx cap open android
```

6. Select **a physical device with Android 16** and click `Run`

7. Open Logcat and use `package:mine` filter to see only the application sample logs and encryption/decryption result added to the console

## Project description

The sample start a loop of randomly generated data that is encrypted within the `Vault` and then decrypted until the `IllegalBlockSizeException` is thrown.

To start or stop the encryption/decryption loop use the button.

The decryption result is written in the console.

All the code related to the issue is in `src\app\home\home.page.ts`.

# ✅ Why the issue might not reproduce on the Android emulator

There are several reasons why AES/CBC padding and chunk-handling bugs—like the one in Identity-Vault’s CryptoData.decrypt—can appear differently on real hardware vs. the emulator:

## 1. Emulators often use a different cryptography provider

Android emulators frequently use the BoringSSL-based security provider from the host machine, while physical devices may use:
- Samsung’s custom crypto provider
- Qualcomm crypto provider
- Android Keystore hardware-backed AES engines
- Vendor-modified OpenSSL variants

Each provider can differ in how strictly it enforces:
- block-size alignment
- padding rules
- IV validation
- decryption error handling

A real device might reject a malformed ciphertext earlier or more strictly, producing:

```
javax.crypto.IllegalBlockSizeException: error:1e000065:Cipher routines::BAD_DECRYPT
```

while the emulator silently fixes or tolerates the malformed padding.

## 2. Hardware-backed keystore behaves differently

If the AES key comes from the AndroidKeyStore, real devices may use:
- TEE / Secure Enclave-style modules
- hardware-backed AES CBC engines
- hardware-enforced key usage constraints

These modules are very strict about invalid CBC block boundaries.
The emulator rarely enforces these constraints and instead falls back to a software JCA implementation.

So your chunking bug may simply go unnoticed.

## 3. Timing and stream behavior differ

Your original failure case was caused by manually chunking ciphertext and feeding incomplete CBC blocks into Cipher.doFinal(), which can result in:
- leftover bytes
- partial blocks
- invalid padding

On emulators, `CipherInputStream` may flush differently or merge reads, accidentally producing a valid block boundary.

On real devices, block reads may be shorter or aligned differently, triggering padding errors.

## 4. CPU architectures behave differently

- Emulators usually run x86_64 crypto implementations.
- Real devices run ARM/ARM64 NEON-accelerated crypto.

Different implementations → different buffering behavior → different sensitivity to malformed CBC input.

# Description of the Issue

On Android, Identity-Vault fails to decrypt stored values when using the default AES-CBC-PKCS5 encryption. The failure is triggered with the exception:

```
javax.crypto.IllegalBlockSizeException: last block incomplete in decryption
```

This bug occurs because the plugin processes ciphertext in arbitrary chunks using `cipher.update()` inside a loop. CBC mode cannot be safely decrypted with manually chunked ciphertext unless the chunk boundaries align perfectly with AES block boundaries (16 bytes). If they do not, Android’s crypto implementation throws the exception above.

---
## Where the Problem Occurs (Identity-Vault Android Code)

Identity-Vault performs encryption/decryption using logic similar to:

```java
while (inputOffset < data.length) {
    int inputLength = Math.min(CHUNK_SIZE, data.length - inputOffset);
    byte[] output = cipher.update(data, inputOffset, inputLength);
    if (output != null) outputStream.write(output);
    inputOffset += inputLength;
}
byte[] finalBytes = cipher.doFinal();
```

### ❌ Why this is wrong

AES/CBC/PKCS5Padding **requires the full ciphertext stream** so padding and block chaining can be validated properly. Feeding fragmented ciphertext into `cipher.update()` breaks block alignment, causing padding to become invalid → resulting in `IllegalBlockSizeException` during decryption.

---

## Proposed Solution

Replace the manual chunked loop with a `CipherInputStream`, which fully supports CBC, PKCS padding, and arbitrary ciphertext lengths without alignment issues.

### ✔ Correct CBC-Safe Implementation

```java
Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
cipher.init(Cipher.DECRYPT_MODE, secretKey, new IvParameterSpec(iv));

ByteArrayInputStream bais = new ByteArrayInputStream(ciphertext);
CipherInputStream cis = new CipherInputStream(bais, cipher);
ByteArrayOutputStream baos = new ByteArrayOutputStream();

byte[] buffer = new byte[2048];
int n;
while ((n = cis.read(buffer)) != -1) {
    baos.write(buffer, 0, n);
}

byte[] decrypted = baos.toByteArray();
```

### ✔ Why this works
- Ensures AES block alignment automatically
- Correctly handles PKCS padding
- Works with any ciphertext size, chunked or continuous
- Prevents `IllegalBlockSizeException`
- Compatible across all Android versions Identity-Vault supports

---

## Expected Outcome

After replacing the chunked `cipher.update()` logic with `CipherInputStream`, stored credentials decrypt correctly on Android with no errors, and behavior matches iOS and Web implementations.

---

## Complete fix in `CryptoData.java`

Below is a corrected implementation of `encrypt` and `decrypt` that we tested and fixed the issue using `CipherInputStream` and `CipherOutputStream`, which are safe for CBC and PKCS padding.

### ✔ Corrected `encrypt` method

```java
public static String encrypt(String alias, String dataJsonString, String customPasscode, Context context)
    throws VaultError {
    try {
        if (customPasscode != null) {
            dataJsonString = PasswordBasedCrypto.encrypt(customPasscode, dataJsonString);
        }

        SecretKey secretKey = getOrCreateKey(alias, context);

        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey);
        byte[] iv = cipher.getIV();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        CipherOutputStream cos = new CipherOutputStream(baos, cipher);
        cos.write(dataJsonString.getBytes(StandardCharsets.UTF_8));
        cos.close();

        byte[] encryptedBytes = baos.toByteArray();

        CryptoData cryptoData = CryptoData.create(encryptedBytes, iv, new byte[0]);
        return cryptoData.toJSON();
    } catch (Exception e) {
        throw new VaultError("CryptoData.encrypt, " + e);
    }
}
```

### ✔ Corrected `decrypt` method

```java
public static String decrypt(String alias, String encryptedDataJson, String customPasscode, Context context)
    throws VaultError, JSONException {
    try {
        CryptoData cryptoData = CryptoData.create(encryptedDataJson);
        SecretKey secretKey = getOrCreateKey(alias, context);

        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey, new IvParameterSpec(cryptoData.iv));

        ByteArrayInputStream bais = new ByteArrayInputStream(cryptoData.data);
        CipherInputStream cis = new CipherInputStream(bais, cipher);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();

        byte[] buffer = new byte[2048];
        int n;
        while ((n = cis.read(buffer)) != -1) {
            baos.write(buffer, 0, n);
        }

        byte[] decryptedDataBytes = baos.toByteArray();
        String decryptedDataJson = new String(decryptedDataBytes, StandardCharsets.UTF_8);

        if (customPasscode != null) {
            CryptoData encryptedPasscodeData = CryptoData.create(decryptedDataJson);
            decryptedDataJson = PasswordBasedCrypto.decrypt(customPasscode, encryptedPasscodeData);
        }

        return decryptedDataJson;
    } catch (Exception e) {
        throw new VaultError("CryptoData.decrypt, " + e);
    }
}
```
