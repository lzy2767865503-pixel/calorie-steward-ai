package com.clinicalclarity.app

import android.app.Application
import com.clinicalclarity.app.data.database.AssetFoodCatalog
import com.clinicalclarity.app.data.database.MealLogStore
import com.clinicalclarity.app.data.image.ImageSanitizer
import com.clinicalclarity.app.data.image.NutritionLabelOcr
import com.clinicalclarity.app.data.network.MealAnalysisClient
import com.clinicalclarity.app.data.repository.MealAnalyzerRepository

class ClinicalClarityApplication : Application() {
    val container: AppContainer by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        AppContainer(this)
    }
}

class AppContainer(application: Application) {
    val foodCatalog by lazy { AssetFoodCatalog(application) }
    val mealLogStore by lazy { MealLogStore(application) }
    val nutritionLabelOcr by lazy { NutritionLabelOcr(application) }
    val mealAnalyzerRepository by lazy {
        MealAnalyzerRepository(
            sanitizer = ImageSanitizer(application.cacheDir),
            remote = MealAnalysisClient(BuildConfig.API_BASE_URL),
        )
    }
}
