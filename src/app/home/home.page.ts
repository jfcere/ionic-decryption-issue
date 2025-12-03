import { Component } from '@angular/core';
import { BrowserVault, DeviceSecurityType, IdentityVaultConfig, Vault, VaultType } from '@ionic-enterprise/identity-vault';
import { Platform } from '@ionic/angular';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  private readonly _VAULT_CONFIG: IdentityVaultConfig = {
    key: 'sample.vault',
    type: VaultType.SecureStorage,
    deviceSecurityType: DeviceSecurityType.None,
    lockAfterBackgrounded: 5000,
    shouldClearVaultAfterTooManyFailedAttempts: true,
    customPasscodeInvalidUnlockAttempts: 2,
    unlockVaultOnLoad: false,
  };

  private readonly _VALUE_KEY = 'sample.value';

  private _vault = this._platform.is('hybrid')
      ? new Vault(this._VAULT_CONFIG)
      : new BrowserVault(this._VAULT_CONFIG);

  private _loopIntervalId: ReturnType<typeof setInterval> | null = null;

  isLooping = false;

  constructor(
    readonly _platform: Platform,
  ) { }

  async toggleDecryptionLoop(): Promise<void> {
    // Toggle the decryption loop state
    this.isLooping = !this.isLooping;

    // Start or stop the decryption loop based on the current state
    this.isLooping
      ? this.startDecryptionLoop()
      : this.stopDecryptionLoop();
  }

  async startDecryptionLoop(): Promise<void> {
    // Start a loop that encrypts and decrypts data every 3 seconds
    this._loopIntervalId = setInterval(async () => {
      await this._encryptAndDecryptData();
    }, 3000);

    console.log('🔄 Starting Decryption Loop');
  }

  stopDecryptionLoop(): void {
    // Clear the interval to stop the decryption loop
    if (this._loopIntervalId !== null) {
      clearInterval(this._loopIntervalId);
      this._loopIntervalId = null;
    }

    console.log('🛑 Stopped Decryption Loop');
  }

  private async _encryptAndDecryptData(): Promise<void> {
    // Generate random data size between 8KB and 24KB
    const minSize = 1024 * 8; // 8KB
    const maxSize = 1024 * 24; // 24KB
    const randomSize = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    
    // Generate random data with the calculated size
    const dataValue = 'A'.repeat(randomSize);
    const dataSizeKB = (randomSize / 1024).toFixed(2);

    // Write data to the vault
    await this._vault.setValue(this._VALUE_KEY, dataValue);

    try {
      // Read and decrypt the data from the vault
      await this._vault.getValue(this._VALUE_KEY);
      console.log(`📦 Generated data size: ${dataSizeKB} KB`);
      console.log('✅ Decrypted Data Successfully');
    } catch (error) {
      // Log decryption errors
      const typedError = error instanceof Error ? error : new Error(JSON.stringify(error));
      console.log(`📦 Generated data size: ${dataSizeKB} KB`);
      console.error('❌ Decryption Error:', typedError.toString());
    }
  }
}
