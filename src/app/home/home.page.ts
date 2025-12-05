import { Component } from '@angular/core';
import { BrowserVault, DeviceSecurityType, IdentityVaultConfig, Vault, VaultType } from '@ionic-enterprise/identity-vault';
import { Platform } from '@ionic/angular';
import data from './data.json';

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

  isProcessing = false;
  log: string = '';

  constructor(
    private readonly _platform: Platform,
  ) { }

  async startProcess(): Promise<void> {
    this.isProcessing = true;
    await this._encryptAndDecryptData();
    this.isProcessing = false;
  }

  private async _encryptAndDecryptData(): Promise<void> {
    // Log separator if there are previous logs
    if (!!this.log.length) {
      this._log('―――――――――――――――――――――――――――――――', 'info');
    }

    try {
      // Write data to the vault
      await this._vault.setValue(this._VALUE_KEY, data);

      // Log encryption success
      this._log("✅ Encrypted Data Successfully", 'info');
    } catch (error) {
      // Log encryption errors
      const typedError = error instanceof Error ? error : new Error(JSON.stringify(error));
      this._log("❌ Encryption Error: " + typedError.toString(), 'error');
    }

    try {
      // Read and decrypt the data from the vault
      await this._vault.getValue(this._VALUE_KEY);

      // Log decryption success
      this._log("✅ Decrypted Data Successfully", 'info');
    } catch (error) {
      // Log decryption errors
      const typedError = error instanceof Error ? error : new Error(JSON.stringify(error));
      this._log("❌ Decryption Error: " + typedError.toString(), 'error');
    }
  }

  private _log(message: string, logLevel: 'info' | 'error'): void {
    this.log += message + '\n';

    if (logLevel === 'info') {
      console.log(message);
    } else {
      console.error(message);
    }
  }
}
