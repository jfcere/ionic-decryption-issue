This is a reproduction sample demonstrating an issue with `Identity-Vault` where decrypting on **real Android 16 devices — especially Pixel and Samsung models —** sometimes throws an `IllegalBlockSizeException`.

The issue is difficult to reproduce because it requires generating data such that a cut falls exactly in the middle of a 16-byte AES block. When this boundary is broken, the block alignment is disrupted, triggering the `IllegalBlockSizeException`.

# 📑 Table of Contents

- [🔧 Starting the Project](#-starting-the-project)
- [📝 Project Description](#-project-description)
- [📱 Why the Issue Might Not Reproduce on the Android Emulator](#-why-the-issue-might-not-reproduce-on-the-android-emulator)
- [🐞 Description of the Issue](#-description-of-the-issue)
- [💡 Proposed Solution](#-proposed-solution)

# 🔧 Starting the Project

1. Create a `.npmrc` file at the root of the project to include the registry for `@ionic-enterprise` packages, replacing `ENTER_YOUR_TOKEN_HERE` with your Ionic access token:

    ```ini
    @ionic-enterprise:registry=https://registry.ionicframework.com/
    //registry.ionicframework.com/:_authToken=ENTER_YOUR_TOKEN_HERE
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Build Ionic:

    ```bash
    npx ionic build
    ```

4. Sync Capacitor:

    ```bash
    npx cap sync
    ```

5. Open the project in Android Studio:

    ```bash
    npx cap open android
    ```

6. Select **a Pixel or Samsung device running Android 16** and click `Run`.

7. Open Logcat and apply the `package:mine` filter to see only application logs and encryption/decryption results.

# 📝 Project Description

This reproduction sample uses fake data encrypted in the `Vault` and then decrypted.

## Reproduction Steps

Follow these steps to reproduce the `IllegalBlockSizeException`:

1. Click the **"Decrypt/Encrypt Data"** button.
2. The app will successfully decrypt the value from the vault and encrypt the data.
3. Kill the app and restart it on the phone **(do not use Android Studio’s Run command for this restart).**
4. Click the **"Decrypt/Encrypt Data"** button again.
5. On the first decryption after restart, you should see the `IllegalBlockSizeException` error.
6. Kill the app and retry; the error will persist.

![Error Snapshot](imgs/error-snapshot.png)

All relevant code related to the issue is located in `src/app/home/home.page.ts`.

## Try the Fix

In Android Studio, open the `CryptoData.java` file at:

```
android/capacitor-cordova-android-plugins/src/main/java/com/ionicframework/IdentityVault
```

Replace the `encrypt` and `decrypt` methods with the ones provided in the [Proposed Solution](#complete-fix-in-cryptodatajava).

1. Clean the Android project via `Build > Clean Project`.
2. Click **Run** on a **Pixel or Samsung Android 16 device**.
3. Repeat the [reproduction steps](#reproduction-steps).
4. The `IllegalBlockSizeException` error should no longer occur.

# 📱 Why the Issue Might Not Reproduce on the Android Emulator

It is possible that Identity-Vault’s AES/CBC bug appears **only on real devices**. Pixel and Samsung phones are the two most common models where CBC decryption errors occur, while the emulator often works fine.

Here’s why:

### 1. Pixel Devices Use Strict BoringSSL Crypto

Google Pixel devices ship with a hardened version of BoringSSL, whose AES/CBC implementation is stricter about:

- Block alignment
- Leftover bytes
- Incorrect padding
- Truncated ciphertext

If decryption receives even one incomplete CBC block because of chunking, Pixel phones immediately throw:

``` 
javax.crypto.IllegalBlockSizeException
javax.crypto.BadPaddingException
error:1e000065:Cipher routines::BAD_DECRYPT
```

The emulator often uses a more permissive desktop OpenSSL implementation or a software provider.

### 2. Samsung Devices Use Hardware-Backed AES Engines

Samsung devices use custom hardware crypto stacks (TrustZone-backed), which behave differently from standard Android JCA providers. Samsung AES/CBC engines:

- Require full 16-byte blocks
- Strictly reject malformed ciphertext
- Perform padding verification in hardware
- Flush buffers differently than the emulator

If CBC data is decrypted in small chunks (like Identity-Vault’s implementation), Samsung devices are more likely to fail.

This explains why many CBC bugs appear only on Samsung Galaxy devices.

### 3. Emulators Do Not Use Hardware Crypto

Android emulators:

- Run x86 software crypto
- Use host machine’s OpenSSL
- Do not use TEE / Secure Hardware
- Behave differently with `CipherInputStream` and padding

This means an emulator may “fix” your chunking by reading data in larger buffers, so errors don’t appear.

On real devices, the malformed chunk is received exactly as produced, causing failure.

### 4. Pixels and Samsungs Handle Input Buffering Differently

- Pixel: BoringSSL CBC eagerly validates blocks
- Samsung: TrustZone CBC validates padding after each block
- Emulator: JCA implementation buffers more data before decrypting

Thus, **the same bug does not trigger on the emulator** due to differences in buffering.

# 🐞 Description of the Issue

On Android, Identity-Vault fails to decrypt stored values using the default AES-CBC-PKCS5 encryption. The failure triggers the exception:

```
javax.crypto.IllegalBlockSizeException: last block incomplete in decryption
```

This occurs because the plugin processes ciphertext in arbitrary chunks via `cipher.update()` inside a loop. CBC mode requires ciphertext to be decrypted with proper block alignment; chunk boundaries must align with 16-byte AES blocks. If not, Android’s crypto throws the exception.

## Where the Problem Occurs (Identity-Vault Android Code)

Identity-Vault uses logic similar to:

```java
while (inputOffset < data.length) {
    int inputLength = Math.min(CHUNK_SIZE, data.length - inputOffset);
    byte[] output = cipher.update(data, inputOffset, inputLength);
    if (output != null) outputStream.write(output);
    inputOffset += inputLength;
}
byte[] finalBytes = cipher.doFinal();
```

## Why This Is Wrong

AES/CBC/PKCS5Padding requires the full ciphertext stream so that padding and chaining can be validated properly. Fragmented ciphertext breaks alignment, invalidates padding, and results in `IllegalBlockSizeException`.

# 💡 Proposed Solution

Replace the manual chunked loop with a `CipherInputStream`, which supports CBC, PKCS padding, and arbitrary ciphertext lengths without alignment issues.

## Correct CBC-Safe Implementation

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

### Why This Works

- Ensures AES block alignment automatically
- Correctly handles PKCS padding
- Works with any ciphertext size, chunked or continuous
- Prevents `IllegalBlockSizeException`
- Compatible across all supported Android versions

# Expected Outcome

After replacing the chunked `cipher.update()` logic with `CipherInputStream`, stored credentials decrypt correctly on Android without errors, matching iOS and Web behavior.

# Complete Fix in `CryptoData.java`

Below is the corrected implementation of the `encrypt` and `decrypt` methods using `CipherInputStream` and `CipherOutputStream` for CBC with PKCS padding.

## Corrected `encrypt` method

```java
public static String encrypt(String alias, String dataJsonString, String customPasscode, Context context)
    throws VaultError {
    try {
        if (customPasscode != null) {
            dataJsonString = PasswordBasedCrypto.encrypt(customPasscode, dataJsonString);
        }
        SecretKey secretKey = getOrCreateKey(alias, context);
        Cipher cipher = Cipher.getInstance(EncryptionConstants.AES_CBC_PADDED_TRANSFORM_ANDROID_M);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey);
        byte[] iv = cipher.getIV();
        byte[] dataBytes = dataJsonString.getBytes(StandardCharsets.UTF_8);

        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        CipherOutputStream cipherOutputStream = new CipherOutputStream(outputStream, cipher);

        cipherOutputStream.write(dataBytes);
        cipherOutputStream.close(); // triggers doFinal()

        byte[] encryptedBytes = outputStream.toByteArray();
        outputStream.close();

        CryptoData cryptoData = CryptoData.create(encryptedBytes, iv, new byte[0]);
        return cryptoData.toJSON();
    } catch (InvalidKeyException e) {
        e.printStackTrace();
        throw new UnexpectedKeystoreError(e.getLocalizedMessage());
    } catch (Exception e) {
        throw new VaultError("CryptoData.encrypt, " + e);
    }
}
```

## Corrected `decrypt` method

```java
public static String decrypt(String alias, String encryptedDataJson, String customPasscode, Context context)
    throws VaultError, JSONException {
    try {
        CryptoData cryptoData = CryptoData.create(encryptedDataJson);
        SecretKey secretKey = getOrCreateKey(alias, context);
        Cipher cipher = Cipher.getInstance(EncryptionConstants.AES_CBC_PADDED_TRANSFORM_ANDROID_M);
        cipher.init(Cipher.DECRYPT_MODE, secretKey, new IvParameterSpec(cryptoData.iv));

        ByteArrayInputStream inputStream = new ByteArrayInputStream(cryptoData.data);
        CipherInputStream cipherInputStream = new CipherInputStream(inputStream, cipher);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();

        byte[] buffer = new byte[4096];
        int read;
        while ((read = cipherInputStream.read(buffer)) != -1) {
            outputStream.write(buffer, 0, read);
        }

        byte[] decryptedDataBytes = outputStream.toByteArray();
        outputStream.close();
        inputStream.close();
        cipherInputStream.close();

        String decryptedDataJson = new String(decryptedDataBytes, StandardCharsets.UTF_8);
        if (customPasscode != null) {
            CryptoData encryptedPasscodeData = CryptoData.create(decryptedDataJson);
            decryptedDataJson = PasswordBasedCrypto.decrypt(customPasscode, encryptedPasscodeData);
        }
        return decryptedDataJson;
    } catch (InvalidKeyException e) {
        e.printStackTrace();
        throw new UnexpectedKeystoreError(e.getLocalizedMessage());
    } catch (JSONException e) {
        e.printStackTrace();
        throw e;
    } catch (Exception e) {
        throw new VaultError("CryptoData.decrypt, " + e);
    }
}
```
