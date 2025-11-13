//YEFTA SARON NADA 1

/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Bell sound synthesis using DAC + DMA + TIM6 trigger (FM synthesis)
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "fatfs.h"
#include <math.h>
#include <string.h>


/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */

/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/


#define PI 3.14159265f
// #define SINE_RES 8192               // <-- Ganti baris ini
// #define HALF_RES (SINE_RES / 2)     // <-- Ganti baris ini
#define SINE_RES 2048                   // <-- Menjadi ini
#define HALF_RES (SINE_RES / 2)         // <-- Menjadi ini (otomatis jadi 1024)
#define LUT_SIZE 1024
/* USER CODE BEGIN PD */

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
DAC_HandleTypeDef hdac;
DMA_HandleTypeDef hdma_dac1;

SD_HandleTypeDef hsd;

TIM_HandleTypeDef htim6;

UART_HandleTypeDef huart2;
UART_HandleTypeDef huart3;

/* Audio buffer (double-buffering DMA mode) */
uint32_t Wave_LUT[SINE_RES];
float sineLUT[LUT_SIZE];

/* === PARAMETER DINAMIS (SCALED) === */
// Ini akan dihitung di Start_Bell_Playback berdasarkan synth_fc
// untuk mencegah suara "pecah" di nada tinggi.
static float s_Qres;             // Q resonansi yang aman
static float s_secondaryRatio;   // Rasio modulator kedua yang aman
static int   s_addPartials;      // Jumlah partials yang aman
static float s_pre_tanh_gain;    // Gain sebelum distorsi yang aman
/* === AKHIR PARAMETER DINAMIS === */

/* === OPTIMIZATION VARS === */
/* Variabel state untuk recursive envelopes */
static float r_env_attack; // (1.0 - env)
static float r_env_decay;
static float r_mod_index;

/* Multiplier per-sample (dihitung sekali) */
static float r_env_attack_mul;
static float r_env_decay_mul;
static float r_mod_index_mul;

/* Koefisien Filter IIR (dihitung sekali) */
static float iir_b0, iir_b1, iir_b2, iir_a1, iir_a2;

/* Amplitudo Partials (dihitung sekali) */
#define MAX_PARTIALS 10 // Pastikan ini = synth_addPartials
static float partial_amps[MAX_PARTIALS + 1];
/* === END OPTIMIZATION VARS === */

/* Playback control */
volatile uint32_t playIndex = 0;
volatile uint32_t totalSamples = 0;
volatile uint8_t playing = 0;

/* FM synthesis parameters */
float synth_fc = 593.67f;    // carrier frequency
float synth_fm = 982.0f;    // modulator frequency
float synth_Io = 0.636f;      // modulation index at t=0
float synth_tau = 2.5f;     // decay constant
float synth_fs = 22050.0f;  // sample rate
float synth_dur = 3.0f;     // duration
float synth_attack = 150.0f;
float synth_decay = 2.5f;
//float synth_noiseLevel = 10.0f;
//float synth_noiseDur = 0.005f; // 5 ms
//int   synth_addPartials = 10;
//float synth_partialDecay = 1.4f;
//float synth_detuneStep = 0.0015f;

// TAMBAHAN YEFTA //
/* === Tambahan Parameter untuk Saron === */
float synth_attackRate = 150.0f;
float synth_decayRate = 2.5f;
float synth_secondaryRatio = 0.25f;
float synth_partialDecay = 1.4f;
float synth_detuneStep = 0.0015f;
int   synth_addPartials = 10;
float synth_noiseLevel = 0.2f;
float synth_noiseDur = 0.005f; // 5 ms
float synth_bp_bw = 0.25f;
float synth_Qres = 10.0f;

// TAMBAHAN YEFTA //



/* USER CODE BEGIN PV */

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_DAC_Init(void);
static void MX_TIM6_Init(void);
static void MX_SDIO_SD_Init(void);
static void MX_USART2_UART_Init(void);
static void MX_USART3_UART_Init(void);
void Error_Handler(void);

/* USER CODE BEGIN PFP */

/* USER CODE END PFP */
/* === Utility Fast Math === */
void Build_SineLUT(void)
{
    for (int i = 0; i < LUT_SIZE; i++)
        sineLUT[i] = sinf(2.0f * PI * i / LUT_SIZE);
}

static inline float fast_sin(float phase)
{
    float x = phase - floorf(phase);
    int idx = (int)(x * LUT_SIZE) & (LUT_SIZE - 1);
    return sineLUT[idx];
}
static inline float fast_cos(float phase)
{
    return fast_sin(phase + 0.25f); // cos(x) = sin(x+pi/2)
}

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */

/* Atur parameter FM bell sound */
void Bell_SetParams(float fc, float fm, float Io, float tau, float dur, float fs)
{
    synth_fc = fc;
    synth_fm = fm;
    synth_Io = Io;
    synth_tau = tau;
    synth_dur = dur;
    synth_fs = fs;
}

/* Isi setengah buffer (DMA half) */
/* Isi setengah buffer (DMA half) */
void Fill_Buffer_Half(uint32_t half)
{
    uint32_t base = (half == 0) ? 0 : HALF_RES;

    static float y1 = 0, y2 = 0, x1 = 0, x2 = 0;
    if (playIndex == 0) {
        y1 = 0; y2 = 0; x1 = 0; x2 = 0;
    }

    static uint32_t noiseSamples = 0;
    if (noiseSamples == 0)
        noiseSamples = (uint32_t)(synth_fs * synth_noiseDur);

    for (uint32_t n = 0; n < HALF_RES; n++)
    {
        if (playIndex >= totalSamples) {
            Wave_LUT[base + n] = 2048;
            continue;
        }

        float t_norm = (float)playIndex / synth_fs;

        /* === Amplitude envelope (RECURSIVE) === */
        float envA = 1.0f - r_env_attack;
        float envD = r_env_decay;
        float ampEnv = envA * envD;

        /* === Time-varying modulation index (RECURSIVE) === */
        float I_t = r_mod_index;

        /* === Secondary FM modulator === */
        float mod_signal = fast_sin(0.3f * t_norm);
        // ❗ Gunakan s_secondaryRatio yang aman
        float mod2 = s_secondaryRatio * synth_Io *
                     fast_sin(synth_fm * 1.6f * t_norm * (1.0f + 0.0005f * mod_signal));

        /* === FM core === */
        float fmPhase = synth_fm * t_norm;
        float fcPhase = synth_fc * t_norm;
        float y_fm = fast_sin(fcPhase + (I_t * fast_sin(fmPhase) + mod2));

        /* === Additive partials === */
        float partials = 0.0f;
        // Penjaga aliasing (tetap dipertahankan)
        const float nyquist_limit = synth_fs * 0.48f;

        // ❗ Gunakan s_addPartials yang aman
        for (int p = 1; p <= s_addPartials; p++)
        {
            float detune = 1.0f + synth_detuneStep * (p - 1);

            // Penjaga Aliasing
            if ((synth_fc * p * detune) >= nyquist_limit)
            {
                break;
            }
            float amp = partial_amps[p];
            partials += amp * fast_sin(synth_fc * p * detune * t_norm);
        }

        /* === Transient noise (5 ms) === */
        float noise = 0.0f;
        if (playIndex < noiseSamples) {
            float fade = 1.0f - (float)playIndex / (float)noiseSamples;
            // ❗ Kurangi noise juga saat nada tinggi (pakai s_secondaryRatio sbg scaler)
            noise = synth_noiseLevel * (s_secondaryRatio / synth_secondaryRatio) * fade * ((rand() % 2000) / 1000.0f - 1.0f);
        }

        /* === Combine components === */
        float y = ampEnv * (0.8f * y_fm + 0.5f * partials) + noise;

        /* === Simple resonant filter (IIR) (PRE-CALCULATED) === */
        float y_filt = (iir_b0*y) + (iir_b1*x1) + (iir_b2*x2) - (iir_a1*y1) - (iir_a2*y2);

        x2 = x1; x1 = y;
        y2 = y1; y1 = y_filt;

        /* === Output scaling === */
        // ❗ Gunakan s_pre_tanh_gain yang aman
        float out = tanhf(s_pre_tanh_gain * y_filt);
        uint32_t dacVal = (uint32_t)((out * 0.5f + 0.5f) * 4095.0f);

        out *= 0.85f;
        Wave_LUT[base + n] = dacVal;

        /* === Update state untuk sample berikutnya === */
        r_env_attack *= r_env_attack_mul;
        r_env_decay  *= r_env_decay_mul;
        r_mod_index  *= r_mod_index_mul;

        playIndex++;
    }
}

/* Mulai playback bell sound */
/* Mulai playback bell sound */
void Start_Bell_Playback(void)
{
    if (playing) return;

    /* =================================================== */
    /* === 1. ATUR PARAMETER DASAR NADA === */
    /* =================================================== */
    // ❗ GANTIPARAMETER DI SINI UNTUK TES (Fc, Fm, Io)
    //
    // Data Anda:
    // N1: 593.67, 982.00, 0.639
    // N2: 639.67, 281.67, 0.611
    // N3: 698.67, 288.00, 0.607
    // N4: 826.00, 201.00, 0.546
    // N5: 885.67, 67.33,  0.638
    // N6: 953.00, 154.00, 0.603
    // N7: 1051.67, 102.33, 0.626

    Bell_SetParams(
        // INI CONTOH NADA 7 (yang pecah)
        593.67f,  // fc: (Fc) carrier frequency
        982.00f,   // fm: (Fm) modulator frequency
        0.639f,    // Io: (Ic) modulation index
        2.5f,      // tau: (Asumsi tetap)
        3.0f,      // dur: (Asumsi tetap)
        22050.0f   // fs:  (Asumsi tetap)
    );


    totalSamples = (uint32_t)(synth_fs * synth_dur);
    if (totalSamples == 0) totalSamples = 1;

    /* =================================================== */
    /* === 2. KALKULASI PARAMETER DINAMIS (PERBAIKAN) === */
    /* =================================================== */
    // Ini adalah kunci perbaikan "suara pecah".
    // Kita "menenangkan" sintesis untuk frekuensi tinggi (Fc).

    // Tentukan "faktor frekuensi tinggi" (hf_factor)
    // 0.0 = nada rendah (aman)
    // 1.0 = nada tinggi (berbahaya)
    const float low_fc = 500.0f;  // Batas bawah aman
    const float high_fc = 900.0f; // Batas atas (di atas Nada 7)

    // Hitung interpolasi linear
    float hf_factor = (synth_fc - low_fc) / (high_fc - low_fc);
    if (hf_factor < 0.0f) hf_factor = 0.0f;
    if (hf_factor > 1.0f) hf_factor = 1.0f;

    // Sekarang gunakan hf_factor untuk menskalakan parameter "berbahaya"
    // Semakin tinggi Fc (hf_factor -> 1.0), semakin KECIL nilainya.

    // 1. Q Factor (Resonansi Filter):
    //    Interpolasi dari Q=10 (setelan lama) ke Q=2 (sangat aman)
    s_Qres = (synth_Qres * (1.0f - hf_factor)) + (1.5f * hf_factor);
    if (s_Qres < 2.0f) s_Qres = 2.0f;

    // 2. Partials (Jumlah):
    //    Interpolasi dari 10 partials (lama) ke 3 partials (aman)
    s_addPartials = (int)((synth_addPartials * (1.0f - hf_factor)) + (2.0f * hf_factor));

    // 3. Secondary Modulator (Ratio):
    //    Interpolasi dari rasio lama (0.25) ke 0.0 (mati)
    s_secondaryRatio = synth_secondaryRatio * (1.0f - hf_factor);

    // 4. Pre-tanh gain (Distorsi):
    //    Interpolasi dari 1.05 (agresif) ke 0.7 (aman)
    s_pre_tanh_gain = (1.0f * (1.0f - hf_factor)) + (0.6f * hf_factor);


    /* =================================================== */
    /* === 3. PRE-CALCULATE RECURSIVE ENVELOPES === */
    /* =================================================== */
    r_env_attack_mul = expf(-synth_attackRate / synth_fs);
    r_env_decay_mul  = expf(-synth_decayRate / synth_fs);
    r_mod_index_mul  = expf(-2.0f / synth_fs); // Sesuai expf(-2.0 * t)

    r_env_attack = 1.0f;
    r_env_decay  = 1.0f;
    r_mod_index  = synth_Io;
    r_mod_index *= (1.0f - 0.4f * hf_factor);

    /* =================================================== */
    /* === 4. PRE-CALCULATE IIR FILTER COEFFICIENTS === */
    /* =================================================== */
    // ❗ Gunakan s_Qres yang sudah aman (scaled)
    float w0 = synth_fc / (synth_fs / 2.0f);
    float alpha = sinf(PI * w0) / (2.0f * s_Qres); // 👈 PERUBAHAN DI SINI
    float b0_raw = alpha;
    float b1_raw = 0.0f;
    float b2_raw = -alpha;
    float a0_raw = 1.0f + alpha;
    float a1_raw = -2.0f * cosf(PI * w0);
    float a2_raw = 1.0f - alpha;

    iir_b0 = b0_raw / a0_raw;
    iir_b1 = b1_raw / a0_raw;
    iir_b2 = b2_raw / a0_raw;
    iir_a1 = a1_raw / a0_raw;
    iir_a2 = a2_raw / a0_raw;


    /* =================================================== */
    /* === 5. PRE-CALCULATE PARTIAL AMPLITUDES === */
    /* =================================================== */
    // ❗ Gunakan s_addPartials yang sudah aman (scaled)
    for (int p = 1; p <= s_addPartials; p++) // 👈 PERUBAHAN DI SINI
    {
        partial_amps[p] = expf(-synth_partialDecay * (p - 1));
    }


    playIndex = 0;
    playing = 1;

    Fill_Buffer_Half(0);

    HAL_DAC_Start_DMA(&hdac, DAC_CHANNEL_1, (uint32_t*)Wave_LUT, SINE_RES, DAC_ALIGN_12B_R);
    HAL_TIM_Base_Start(&htim6);

    Fill_Buffer_Half(1);
}

/* Stop playback */
void Stop_Bell_Playback(void)
{
    if (!playing) return;
    HAL_TIM_Base_Stop(&htim6);
    HAL_DAC_Stop_DMA(&hdac, DAC_CHANNEL_1);
    playing = 0;
}

/* Callback DMA half complete */
void HAL_DAC_ConvHalfCpltCallbackCh1(DAC_HandleTypeDef *hdac_ptr)
{
    (void)hdac_ptr;
    if (playing)
        Fill_Buffer_Half(0);
}

/* Callback DMA full complete */
void HAL_DAC_ConvCpltCallbackCh1(DAC_HandleTypeDef *hdac_ptr)
{
    (void)hdac_ptr;
    if (playing) {
        Fill_Buffer_Half(1);
        if (playIndex >= totalSamples)
            Stop_Bell_Playback();
    }
}

/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{

  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_DMA_Init();
  MX_DAC_Init();
  MX_TIM6_Init();
  MX_SDIO_SD_Init();
  MX_USART2_UART_Init();
  MX_USART3_UART_Init();
  MX_FATFS_Init();

  Build_SineLUT();  // 🔹 Precompute lookup table untuk cepat

  /* USER CODE BEGIN 2 */

  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {  /* Tombol PA0 untuk trigger bell */
      if (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0) == GPIO_PIN_SET)
      {
          HAL_Delay(0);
          if (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0) == GPIO_PIN_SET)
          {
              Start_Bell_Playback();
              while (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0) == GPIO_PIN_SET)
                  HAL_Delay(0);
          }
      }

    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Configure the main internal regulator output voltage
  */
  __HAL_RCC_PWR_CLK_ENABLE();
  __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE1);

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI|RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState = RCC_HSE_ON;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLM = 8;
  RCC_OscInitStruct.PLL.PLLN = 336;
  RCC_OscInitStruct.PLL.PLLP = RCC_PLLP_DIV4;
  RCC_OscInitStruct.PLL.PLLQ = 4;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
  HAL_RCC_MCOConfig(RCC_MCO1, RCC_MCO1SOURCE_HSI, RCC_MCODIV_1);
}

/**
  * @brief DAC Initialization Function
  * @param None
  * @retval None
  */
static void MX_DAC_Init(void)
{

  /* USER CODE BEGIN DAC_Init 0 */

  /* USER CODE END DAC_Init 0 */

  DAC_ChannelConfTypeDef sConfig = {0};

  /* USER CODE BEGIN DAC_Init 1 */

  /* USER CODE END DAC_Init 1 */

  /** DAC Initialization
  */
  hdac.Instance = DAC;
  if (HAL_DAC_Init(&hdac) != HAL_OK)
  {
    Error_Handler();
  }

  /** DAC channel OUT1 config
  */
  sConfig.DAC_Trigger = DAC_TRIGGER_T6_TRGO;
  sConfig.DAC_OutputBuffer = DAC_OUTPUTBUFFER_ENABLE;
  if (HAL_DAC_ConfigChannel(&hdac, &sConfig, DAC_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }

  /** DAC channel OUT2 config
  */
  if (HAL_DAC_ConfigChannel(&hdac, &sConfig, DAC_CHANNEL_2) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN DAC_Init 2 */

  /* USER CODE END DAC_Init 2 */

}

/**
  * @brief SDIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_SDIO_SD_Init(void)
{

  /* USER CODE BEGIN SDIO_Init 0 */

  /* USER CODE END SDIO_Init 0 */

  /* USER CODE BEGIN SDIO_Init 1 */

  /* USER CODE END SDIO_Init 1 */
  hsd.Instance = SDIO;
  hsd.Init.ClockEdge = SDIO_CLOCK_EDGE_RISING;
  hsd.Init.ClockBypass = SDIO_CLOCK_BYPASS_DISABLE;
  hsd.Init.ClockPowerSave = SDIO_CLOCK_POWER_SAVE_DISABLE;
  hsd.Init.BusWide = SDIO_BUS_WIDE_4B;
  hsd.Init.HardwareFlowControl = SDIO_HARDWARE_FLOW_CONTROL_DISABLE;
  hsd.Init.ClockDiv = 0;
  /* USER CODE BEGIN SDIO_Init 2 */

  /* USER CODE END SDIO_Init 2 */

}

/**
  * @brief TIM6 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM6_Init(void)
{

  /* USER CODE BEGIN TIM6_Init 0 */

  /* USER CODE END TIM6_Init 0 */

  TIM_MasterConfigTypeDef sMasterConfig = {0};

  /* USER CODE BEGIN TIM6_Init 1 */

  /* USER CODE END TIM6_Init 1 */
  htim6.Instance = TIM6;
  htim6.Init.Prescaler = 0;
  htim6.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim6.Init.Period = 3809;
  htim6.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim6) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_UPDATE;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim6, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN TIM6_Init 2 */

  /* USER CODE END TIM6_Init 2 */

}

/**
  * @brief USART2 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART2_UART_Init(void)
{

  /* USER CODE BEGIN USART2_Init 0 */

  /* USER CODE END USART2_Init 0 */

  /* USER CODE BEGIN USART2_Init 1 */

  /* USER CODE END USART2_Init 1 */
  huart2.Instance = USART2;
  huart2.Init.BaudRate = 115200;
  huart2.Init.WordLength = UART_WORDLENGTH_8B;
  huart2.Init.StopBits = UART_STOPBITS_1;
  huart2.Init.Parity = UART_PARITY_NONE;
  huart2.Init.Mode = UART_MODE_TX_RX;
  huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart2.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart2) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN USART2_Init 2 */

  /* USER CODE END USART2_Init 2 */

}

/**
  * @brief USART3 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART3_UART_Init(void)
{

  /* USER CODE BEGIN USART3_Init 0 */

  /* USER CODE END USART3_Init 0 */

  /* USER CODE BEGIN USART3_Init 1 */

  /* USER CODE END USART3_Init 1 */
  huart3.Instance = USART3;
  huart3.Init.BaudRate = 115200;
  huart3.Init.WordLength = UART_WORDLENGTH_8B;
  huart3.Init.StopBits = UART_STOPBITS_1;
  huart3.Init.Parity = UART_PARITY_NONE;
  huart3.Init.Mode = UART_MODE_TX_RX;
  huart3.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart3.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart3) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN USART3_Init 2 */

  /* USER CODE END USART3_Init 2 */

}

/**
  * Enable DMA controller clock
  */
static void MX_DMA_Init(void)
{

  /* DMA controller clock enable */
  __HAL_RCC_DMA1_CLK_ENABLE();

  /* DMA interrupt init */
  /* DMA1_Stream5_IRQn interrupt configuration */
  HAL_NVIC_SetPriority(DMA1_Stream5_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(DMA1_Stream5_IRQn);

}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};
  /* USER CODE BEGIN MX_GPIO_Init_1 */

  /* USER CODE END MX_GPIO_Init_1 */

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOH_CLK_ENABLE();
  __HAL_RCC_GPIOC_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pins : PC2 PC3 */
  GPIO_InitStruct.Pin = GPIO_PIN_2|GPIO_PIN_3;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_RISING;
  GPIO_InitStruct.Pull = GPIO_PULLDOWN;
  HAL_GPIO_Init(GPIOC, &GPIO_InitStruct);

  /*Configure GPIO pins : PA0 PA1 */
  GPIO_InitStruct.Pin = GPIO_PIN_0|GPIO_PIN_1;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_RISING;
  GPIO_InitStruct.Pull = GPIO_PULLDOWN;
  HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

  /*Configure GPIO pin : PA8 */
  GPIO_InitStruct.Pin = GPIO_PIN_8;
  GPIO_InitStruct.Mode = GPIO_MODE_AF_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  GPIO_InitStruct.Alternate = GPIO_AF0_MCO;
  HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

  /*Configure GPIO pins : PB5 PB6 PB7 */
  GPIO_InitStruct.Pin = GPIO_PIN_5|GPIO_PIN_6|GPIO_PIN_7;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_RISING;
  GPIO_InitStruct.Pull = GPIO_PULLDOWN;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

  /* USER CODE BEGIN MX_GPIO_Init_2 */

  /* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */

/* USER CODE END 4 */


/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
