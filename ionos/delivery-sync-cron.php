<?php
// Delivery Sync – Cron-Auslöser für IONOS Webhosting.
//
// Ablage:  /shopify-dhl-app/cron/delivery-sync-cron.php
// Config:  /shopify-dhl-app/config/delivery-sync.php  (NICHT in /public)
// IONOS Cronjob: alle 10 Minuten dieses Skript ausführen.
//
// - Jeder Lauf: GET /health   -> hält die kostenlose Render-Instanz wach
// - Erster Lauf jeder Stunde (Minute 00–09): POST /api/cron/sync

$config = require __DIR__ . '/../config/delivery-sync.php';
// Erwartet: ['app_url' => 'https://...', 'cron_secret' => '...']

function request(string $method, string $url, array $headers = [], int $timeout = 30): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 90, // Aufwachen der Render Free Instanz
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    return [$status, $body === false ? $error : $body];
}

$appUrl = rtrim($config['app_url'], '/');
$log = __DIR__ . '/../logs/delivery-sync-cron.log';
$now = date('Y-m-d H:i:s');

[$status] = request('GET', $appUrl . '/health', [], 120);
$line = "$now ping $status";

if ((int) date('i') < 10) {
    [$status, $body] = request('POST', $appUrl . '/api/cron/sync', [
        'Authorization: Bearer ' . $config['cron_secret'],
        'Content-Length: 0',
    ], 600);
    $line .= " | sync $status " . substr((string) $body, 0, 200);
}

file_put_contents($log, $line . PHP_EOL, FILE_APPEND);
