package com.clinicalclarity.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.clinicalclarity.app.ui.ClinicalClarityApp
import com.clinicalclarity.app.ui.MainViewModel
import com.clinicalclarity.app.ui.theme.ClinicalClarityTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ClinicalClarityTheme {
                ClinicalClarityApp(viewModel = viewModel)
            }
        }
    }
}
